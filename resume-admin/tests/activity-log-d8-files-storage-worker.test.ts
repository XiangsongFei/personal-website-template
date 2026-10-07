import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkerRequest, type WorkerEnv } from "../src/worker/index";

const resumeId="ea111111-1111-4111-8111-111111111111";
const actorId="10000000-0000-4000-8000-000000000002";
const uploadId="d1111111-1111-4111-8111-111111111111";
const objectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const key="00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const pdf=new TextEncoder().encode("%PDF-1.7 valid fixture");
const auth=`Bearer ${btoa(JSON.stringify({alg:"HS256"})).replaceAll("=","")}.${btoa(JSON.stringify({sub:actorId,role:"authenticated"})).replaceAll("=","")}.synthetic`;
function env(): WorkerEnv { return {ASSETS:{fetch:async()=>new Response("asset")},SUPABASE_URL:"https://local.test",SUPABASE_PUBLISHABLE_KEY:"publishable",
  ACTIVITY_LOG_HMAC_KEY_ID:"activity_log_v11_hmac_v1",ACTIVITY_LOG_HMAC_KEY:key}; }
function uploadRequest(locale="en",bytes:Uint8Array=pdf,headers:Record<string,string>={},includeLegacyFilename=true) {
  const requestHeaders:Record<string,string>={Authorization:auth,"Content-Type":"application/pdf","X-Upload-Request-ID":uploadId,...headers};
  if(includeLegacyFilename) requestHeaders["X-Original-Filename"]="resume.pdf";
  return new Request(`https://qa.test/api/admin/v1/files/upload?locale=${locale}`,{method:"POST",headers:requestHeaders,body:new Uint8Array(bytes)});
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("D-8 Worker authenticated PDF Storage protocol",()=>{
  it("validates, prepares, inserts without overwrite, verifies bytes, and completes under the same user JWT",async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];
    let candidateObjectName="";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(url.endsWith("/rpc/prepare_resume_file_upload_v1")) {
        candidateObjectName=(JSON.parse(String(init?.body)) as {candidate_object_name:string}).candidate_object_name;
        return Response.json([{object_name:candidateObjectName,upload_status:"prepared"}]);
      }
      if(url===`https://local.test/storage/v1/object/resume-files/${candidateObjectName}`) return Response.json({Key:"inserted"});
      if(url===`https://local.test/storage/v1/object/authenticated/resume-files/${candidateObjectName}`) return new Response(pdf,{status:200});
      if(url.endsWith("/rpc/complete_resume_file_upload_v1")) return Response.json(true);
      return new Response("unexpected",{status:404});
    }));
    const response=await handleWorkerRequest(uploadRequest(),env());
    expect(response.status,await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({reference:`https://local.test/storage/v1/object/public/resume-files/${candidateObjectName}`,upload_request_id:uploadId});
    const storage=calls.find(call=>call.url.includes("/storage/v1/object/resume-files/"))!;
    expect(storage.init?.method).toBe("POST");expect(new Headers(storage.init?.headers).get("x-upsert")).toBe("false");
    expect(new Headers(storage.init?.headers).get("Authorization")).toBe(auth);
    expect(new Headers(storage.init?.headers).get("apikey")).toBe("publishable");
    expect(new Headers(storage.init?.headers).get("Content-Type")).toBe("application/pdf");
    const prepare=JSON.parse(String(calls.find(call=>call.url.endsWith("prepare_resume_file_upload_v1"))?.init?.body)) as Record<string,unknown>;
    expect(prepare).toMatchObject({target_resume_id:resumeId,target_locale:"en",target_request_id:uploadId,target_byte_size:pdf.byteLength});
    expect(prepare.candidate_object_name).toMatch(new RegExp(`^${resumeId}/en/[0-9a-f-]{36}\\.pdf$`));
    expect(JSON.stringify(prepare)).not.toMatch(/service_role|resume_id.*browser/i);
    const body=storage.init?.body;
    if (!(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) throw new Error("Expected the Worker to send raw PDF bytes.");
    const sentBytes=body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer as ArrayBuffer,body.byteOffset,body.byteLength);
    expect(Array.from(sentBytes)).toEqual(Array.from(pdf));
    expect(calls.some(call=>call.url.includes("resume_locale_content"))).toBe(false);
  });

  it("decodes UTF-8 filename metadata while keeping the managed object path generated",async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];let candidateObjectName="";
    const filename="../中文 resume.pdf";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(url.endsWith("/rpc/prepare_resume_file_upload_v1")) {
        candidateObjectName=(JSON.parse(String(init?.body)) as {candidate_object_name:string}).candidate_object_name;
        return Response.json([{object_name:candidateObjectName,upload_status:"prepared"}]);
      }
      if(url===`https://local.test/storage/v1/object/resume-files/${candidateObjectName}`) return Response.json({Key:"inserted"});
      if(url===`https://local.test/storage/v1/object/authenticated/resume-files/${candidateObjectName}`) return new Response(pdf,{status:200});
      if(url.endsWith("/rpc/complete_resume_file_upload_v1")) return Response.json(true);
      return new Response("unexpected",{status:404});
    }));
    const response=await handleWorkerRequest(uploadRequest("zh",pdf,{"X-Original-Filename-UTF8-Percent-Encoded":encodeURIComponent(filename)},false),env());
    expect(response.status,await response.clone().text()).toBe(200);
    expect(candidateObjectName).toMatch(new RegExp(`^${resumeId}/zh/[0-9a-f-]{36}\\.pdf$`));
    expect(candidateObjectName).not.toContain(filename);
    const storage=calls.find(call=>call.url===`https://local.test/storage/v1/object/resume-files/${candidateObjectName}`)!;
    const metadataHeader=new Headers(storage.init?.headers).get("x-metadata")!;
    const metadataBytes=Uint8Array.from(atob(metadataHeader),character=>character.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(metadataBytes))).toEqual({originalFilename:filename});
  });

  it.each([
    ["malformed percent encoding","%E0%A4%A"],
    ["oversized encoded value","x".repeat(1537)],
    ["oversized decoded value",encodeURIComponent("x".repeat(256))],
  ])("rejects %s before any upstream DB or Storage request",async(_name,encoded)=>{
    const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    const response=await handleWorkerRequest(uploadRequest("zh",pdf,{"X-Original-Filename-UTF8-Percent-Encoded":encoded},false),env());
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:{code:"invalid_upload_request"}});
    expect(upstream).not.toHaveBeenCalled();
  });

  it("fails closed when the legacy and encoded filename headers conflict",async()=>{
    const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    const response=await handleWorkerRequest(uploadRequest("zh",pdf,{"X-Original-Filename-UTF8-Percent-Encoded":encodeURIComponent("other.pdf")}),env());
    expect(response.status).toBe(400);expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ["non-PDF bytes","%NOTPDF".split("").map(ch=>ch.charCodeAt(0)),{} ,422],
    ["wrong MIME",[...pdf],{"Content-Type":"application/octet-stream"},415],
    ["empty body",[],{},422],
    ["over limit",new Array(10*1024*1024+1).fill(0),{},413],
  ] as const)("rejects %s before contacting Supabase",async(_name,bytes,headers,status)=>{
    const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    const response=await handleWorkerRequest(uploadRequest("en",Uint8Array.from(bytes),headers),env());
    expect(response.status).toBe(status);expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a browser-selected target, path, bucket, or purpose before upstream access",async()=>{
    const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    const response=await handleWorkerRequest(new Request(`https://qa.test/api/admin/v1/files/upload?locale=en&resume_id=${resumeId}`,{
      method:"POST",headers:{Authorization:auth,"Content-Type":"application/pdf","X-Upload-Request-ID":uploadId,"X-Original-Filename":"resume.pdf",
        "X-Object-Path":`${resumeId}/en/${objectId}.pdf`},body:new Uint8Array(pdf)}),env());
    expect(response.status).toBe(400);expect(upstream).not.toHaveBeenCalled();
  });

  it("conflicts on changed bytes for an existing upload request UUID",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(String(input).endsWith("/rpc/prepare_resume_file_upload_v1")) return new Response('{"code":"P13B1"}',{status:400});
      throw new Error("must not reach Storage");
    }));
    const response=await handleWorkerRequest(uploadRequest("en",new TextEncoder().encode("%PDF-1.7 different")),env());
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:"upload_request_conflict"}});
  });

  it("reconciles the same request and digest to the original immutable candidate without overwriting",async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];let candidate="";let prepared=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(url.endsWith("/rpc/prepare_resume_file_upload_v1")) {
        prepared++;
        if(prepared===1) candidate=(JSON.parse(String(init?.body)) as {candidate_object_name:string}).candidate_object_name;
        return Response.json([{object_name:candidate,upload_status:prepared===1?"prepared":"uploaded"}]);
      }
      if(url===`https://local.test/storage/v1/object/resume-files/${candidate}`) return new Response("already exists",{status:409});
      if(url===`https://local.test/storage/v1/object/authenticated/resume-files/${candidate}`) return new Response(pdf,{status:200});
      if(url.endsWith("/rpc/complete_resume_file_upload_v1")) return Response.json(true);
      return new Response("unexpected",{status:404});
    }));
    const first=await handleWorkerRequest(uploadRequest(),env());
    const second=await handleWorkerRequest(uploadRequest(),env());
    expect(first.status).toBe(200);expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(calls.filter(call=>call.init?.method==="POST"&&call.url.includes("/storage/v1/object/")).length).toBe(1);
    expect(calls.filter(call=>call.init?.method==="GET").length).toBe(2);
    expect(calls.filter(call=>call.url.endsWith("/rpc/prepare_resume_file_upload_v1"))).toHaveLength(2);
  });

  it("reconciles an ambiguous candidate cleanup without re-uploading or losing its request identity",async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];
    const candidate=`${resumeId}/en/${objectId}.pdf`;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(url.endsWith("/rpc/prepare_resume_file_upload_v1")) return Response.json([{object_name:candidate,upload_status:"cleanup_pending"}]);
      if(url.endsWith("/rpc/request_resume_file_candidate_cleanup_v1")) return Response.json(0);
      if(url.endsWith("/rpc/claim_resume_file_cleanup_v1")) return Response.json([{cleanup_id:objectId,object_name:candidate}]);
      if(url===`https://local.test/storage/v1/object/resume-files/${candidate}`&&init?.method==="DELETE") return new Response("not found",{status:404});
      if(url.endsWith("/rpc/complete_resume_file_cleanup_v1")) return Response.json(true);
      return new Response("unexpected",{status:404});
    }));
    const response=await handleWorkerRequest(uploadRequest(),env());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error:{code:"upload_candidate_cleaned"}});
    expect(calls.some(call=>call.url.includes("/storage/v1/object/resume-files/")&&call.init?.method==="POST")).toBe(false);
    expect(calls.some(call=>call.url.includes("/storage/v1/object/resume-files/")&&call.init?.method==="DELETE")).toBe(true);
  });

  it("cleans an expired prepared intent without attempting Storage INSERT or renewing authority",async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];
    const candidate=`${resumeId}/en/${objectId}.pdf`;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(url.endsWith("/rpc/prepare_resume_file_upload_v1")) return Response.json([{object_name:candidate,upload_status:"expired"}]);
      if(url.endsWith("/rpc/request_resume_file_candidate_cleanup_v1")) return Response.json(1);
      if(url.endsWith("/rpc/claim_resume_file_cleanup_v1")) return Response.json([{cleanup_id:objectId,object_name:candidate}]);
      if(url===`https://local.test/storage/v1/object/resume-files/${candidate}`&&init?.method==="DELETE") return new Response("not found",{status:404});
      if(url.endsWith("/rpc/complete_resume_file_cleanup_v1")) return Response.json(true);
      return new Response("unexpected",{status:404});
    }));
    const response=await handleWorkerRequest(uploadRequest(),env());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error:{code:"upload_candidate_cleaned"}});
    expect(calls.some(call=>call.init?.method==="POST"&&call.url.includes("/storage/v1/object/resume-files/"))).toBe(false);
    expect(calls.filter(call=>call.url.endsWith("/rpc/prepare_resume_file_upload_v1"))).toHaveLength(1);
    expect(calls.some(call=>call.url.endsWith("/rpc/request_resume_file_candidate_cleanup_v1"))).toBe(true);
    expect(calls.some(call=>call.url.endsWith("/rpc/complete_resume_file_cleanup_v1"))).toBe(true);
  });

  it("cleanup accepts only opaque upload IDs and uses the authenticated session for exact Storage deletion",async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/rpc/resolve_admin_files_storage_target_v1")) return Response.json(resumeId);
      if(url.endsWith("/rpc/request_resume_file_candidate_cleanup_v1")) return Response.json(1);
      if(url.endsWith("/rpc/claim_resume_file_cleanup_v1")) return Response.json([{cleanup_id:objectId,object_name:`${resumeId}/en/${objectId}.pdf`}]);
      if(url===`https://local.test/storage/v1/object/resume-files/${resumeId}/en/${objectId}.pdf`) return Response.json({Key:"deleted"});
      if(url.endsWith("/rpc/complete_resume_file_cleanup_v1")) return Response.json(true);
      return new Response("unexpected",{status:404});
    }));
    const response=await handleWorkerRequest(new Request("https://qa.test/api/admin/v1/files/cleanup",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},
      body:JSON.stringify({upload_request_ids:[uploadId]})}),env());
    expect(response.status).toBe(200);expect(await response.json()).toEqual({cleanup_warning:false});
    const deletion=calls.find(call=>call.init?.method==="DELETE")!;
    expect(new Headers(deletion.init?.headers).get("Authorization")).toBe(auth);
    const candidate=JSON.parse(String(calls.find(call=>call.url.endsWith("request_resume_file_candidate_cleanup_v1"))?.init?.body)) as Record<string,unknown>;
    expect(candidate).toEqual({target_resume_id:resumeId,target_request_ids:[uploadId]});
    expect(JSON.stringify(candidate)).not.toContain("object_name");
  });
});
