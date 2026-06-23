import { auth } from '@clerk/nextjs/server';

export const protectRoute = async (
  request: Request,
  requireAuth: boolean = true
): Promise<{
  ok: boolean;
  userId?: string;
  error?: string;
  status?: number;
}> => {
  // Validate Content-Type for mutation methods
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentType = request.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return { ok: false, error: 'Invalid content type', status: 400 };
    }
  }

  // Reject oversized bodies (10MB hard limit)
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
    return { ok: false, error: 'Request too large', status: 413 };
  }

  if (requireAuth) {
    const { userId } = auth();
    if (!userId) {
      return { ok: false, error: 'Unauthorized', status: 401 };
    }
    return { ok: true, userId };
  }

  return { ok: true };
};
