export function needsDeepPageBootstrap(
  page: number,
  sortJson: string,
  afterId: number | undefined,
  supportsKeyset: (sortJson: string) => boolean,
): boolean {
  return page > 1 && supportsKeyset(sortJson) && afterId == null;
}

export function shouldWarnOffsetPageJump(
  targetPage: number,
  sortJson: string,
  supportsKeyset: (sortJson: string) => boolean,
  threshold = 10,
): boolean {
  return !supportsKeyset(sortJson) && targetPage > threshold;
}
