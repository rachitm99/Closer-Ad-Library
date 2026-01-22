import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/session',
  '/api/debug/',
  '/api/debug',
  '/api/debug/',
  '/_next/',
  '/favicon.ico',
  '/robots.txt',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // If user is trying to reach /login while already authenticated, redirect to home
  const cookie = req.cookies.get('fb_session')
  if (pathname === '/login' && cookie) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  }

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()

  // Check for session cookie
  if (!cookie) {
    // redirect to login
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // allow request to proceed; server APIs will verify the cookie
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth/session|_next/static|_next/image|favicon.ico).*)'],
}
