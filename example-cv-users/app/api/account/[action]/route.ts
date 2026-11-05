// Authenticated API requests are handled by worker/index.ts before RSC.
// A renderer-only startup must fail closed instead of emulating account APIs.
export const dynamic = 'force-dynamic';
export function GET() {
    return Response.json({ ok: false, message: '账户服务未启动。' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
}
export const POST = GET;
