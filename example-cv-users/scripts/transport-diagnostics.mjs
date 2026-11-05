// Never include messages, stacks, headers, payloads or arbitrary cause values.
const NAMES=new Set(['TypeError','Error','AbortError','TimeoutError','InvalidArgumentError','SyntaxError']);
const CODES=new Set(['UND_ERR_INVALID_ARG','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UND_ERR_ABORTED','ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ERR_INVALID_ARG_TYPE','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED']);
export function safeError(e){return {errorName:NAMES.has(e?.name)?e.name:'Other',errorCode:CODES.has(e?.code)?e.code:null,causeName:NAMES.has(e?.cause?.name)?e.cause.name:null,causeCode:CODES.has(e?.cause?.code)?e.cause.code:null};}
export function transportHeaders(input){const h=new Headers(input);for(const n of ['host','content-length','transfer-encoding','connection','keep-alive','te','trailer','upgrade','proxy-authorization','proxy-authenticate'])h.delete(n);return h;}
