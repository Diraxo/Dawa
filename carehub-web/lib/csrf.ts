export const validateOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    'https://dawa.com',
    'https://www.dawa.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
  ].filter(Boolean) as string[];

  if (!origin) return false;
  return allowedOrigins.includes(origin);
};

export const validateMethod = (
  request: Request,
  allowed: string[]
): boolean => {
  return allowed.includes(request.method);
};
