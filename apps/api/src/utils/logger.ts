export function logInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  const entry = {
    level: 'info',
    timestamp: new Date().toISOString(),
    scope,
    message,
    ...(meta ? { meta } : {})
  };
  console.log(JSON.stringify(entry));
}

export function logError(scope: string, message: string, error?: unknown) {
  const entry = {
    level: 'error',
    timestamp: new Date().toISOString(),
    scope,
    message,
    error: error instanceof Error ? error.message : String(error ?? '')
  };
  console.error(JSON.stringify(entry));
}
