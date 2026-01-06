// Firebase handles client-side auth; no server-side auth handler needed for this app
export async function GET() {
  return new Response(null, { status: 404 })
}
export async function POST() {
  return new Response(null, { status: 404 })
}
