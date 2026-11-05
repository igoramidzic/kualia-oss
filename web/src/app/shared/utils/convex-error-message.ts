import { ConvexError } from 'convex/values';

export function extractConvexErrorMessage(error: unknown, fallback: string): string {
  const dataMessage = extractDataMessage(error);
  if (dataMessage) {
    return dataMessage;
  }

  if (!(error instanceof Error)) {
    return fallback;
  }

  const rawMessage = error.message.trim();
  const dataMessageFromRaw = extractDataMessageFromRawMessage(rawMessage);
  if (dataMessageFromRaw) {
    return dataMessageFromRaw;
  }

  const convexMessage = extractWrappedConvexErrorMessage(rawMessage);
  if (convexMessage) {
    return convexMessage;
  }

  if (isWrappedConvexClientMessage(rawMessage)) {
    return fallback;
  }

  return rawMessage.length > 0 ? rawMessage : fallback;
}

export function extractMappedConvexErrorMessage(
  error: unknown,
  fallback: string,
  mapMessage: (message: string) => string
): string {
  return mapMessage(extractConvexErrorMessage(error, fallback));
}

function extractDataMessage(error: unknown): string | null {
  if (error instanceof ConvexError) {
    return extractStringMessage(error.data);
  }

  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return null;
  }

  return extractStringMessage(error.data);
}

function extractStringMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value !== 'object' || value === null || !('message' in value)) {
    return null;
  }

  const message = value.message;
  if (typeof message !== 'string') {
    return null;
  }

  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractDataMessageFromRawMessage(rawMessage: string): string | null {
  const match = /data:\s*"((?:\\.|[^"])*)"/.exec(rawMessage);
  if (!match) {
    return null;
  }

  const message = match[1].replace(/\\"/g, '"').trim();
  return message.length > 0 ? message : null;
}

function extractWrappedConvexErrorMessage(rawMessage: string): string | null {
  const marker = 'ConvexError:';
  const markerIndex = rawMessage.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return cleanWrappedConvexErrorMessage(rawMessage.slice(markerIndex + marker.length));
}

function cleanWrappedConvexErrorMessage(message: string): string | null {
  const firstLine = message.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const withoutClientSuffix = firstLine.replace(/\s+Called by client.*$/u, '').trim();
  const stackIndex = withoutClientSuffix.search(/\s+at\s+(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/u);
  const withoutStack = stackIndex >= 0 ? withoutClientSuffix.slice(0, stackIndex).trim() : withoutClientSuffix;

  return withoutStack.length > 0 ? withoutStack : null;
}

function isWrappedConvexClientMessage(rawMessage: string): boolean {
  return (
    rawMessage.includes('[CONVEX') || rawMessage.includes('Called by client') || rawMessage.includes('Server Error')
  );
}
