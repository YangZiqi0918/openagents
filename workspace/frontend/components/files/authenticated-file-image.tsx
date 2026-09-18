'use client';

import type { ImgHTMLAttributes } from 'react';
import { FileImage, Loader2 } from 'lucide-react';
import { useFileBlobUrl } from '@/hooks/use-file-blob-url';

export function AuthenticatedFileImage({ fileId, contentType, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fileId: string; contentType?: string }) {
  const { url, error } = useFileBlobUrl(fileId, contentType);
  if (!url) {
    return <span className="inline-flex h-16 items-center justify-center px-4 text-muted-foreground" title={error || undefined}>{error ? <FileImage className="size-5" /> : <Loader2 className="size-4 animate-spin" />}</span>;
  }
  return <img {...props} src={url} />;
}
