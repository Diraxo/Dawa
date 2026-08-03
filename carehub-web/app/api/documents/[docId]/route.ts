import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const SAFE_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(
  request: Request,
  { params }: { params: { docId: string } }
) {
  const { userId: clerkId } = auth();
  if (!clerkId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: SAFE_HEADERS,
    });
  }

  // Only admins may generate signed URLs for doctor documents
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('clerk_id', clerkId)
    .single();

  if (user?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: SAFE_HEADERS,
    });
  }

  // Prevent path traversal
  const docPath = decodeURIComponent(params.docId);
  if (docPath.includes('..') || docPath.includes('//')) {
    return new Response(JSON.stringify({ error: 'Invalid document path' }), {
      status: 400,
      headers: SAFE_HEADERS,
    });
  }

  // Signed URL valid for 5 minutes only — stops URL sharing from being useful
  const { data, error } = await supabaseAdmin.storage
    .from('doctor-documents')
    .createSignedUrl(docPath, 300);

  if (error || !data?.signedUrl) {
    return new Response(JSON.stringify({ error: 'Document not found' }), {
      status: 404,
      headers: SAFE_HEADERS,
    });
  }

  return new Response(JSON.stringify({ url: data.signedUrl }), {
    headers: SAFE_HEADERS,
  });
}
