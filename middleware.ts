import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

export const config = {
  matcher: ['/api/:path*'],
}

export function middleware(req: NextRequest) {
  // Deja pasar login sin token
  if (req.nextUrl.pathname.startsWith('/api/login')) {
    return NextResponse.next()
  }

  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return new NextResponse('Unauthorized', { status: 401 })

  try {
    jwt.verify(token, process.env.JWT_SECRET!)
    return NextResponse.next()
  } catch {
    return new NextResponse('Forbidden', { status: 403 })
  }
}
