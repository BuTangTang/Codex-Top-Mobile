export type CodexAppServerReviewTarget =
  | Readonly<{ type: 'uncommittedChanges' }>
  | Readonly<{ type: 'baseBranch'; branch: string }>
  | Readonly<{ type: 'commit'; sha: string; title?: string }>
  | Readonly<{ type: 'custom'; instructions: string }>;

export type CodexAppServerReviewStartRequest = Readonly<{
  target: CodexAppServerReviewTarget;
  delivery: 'inline' | 'detached';
}>;

export type CodexAppServerReviewStartUnsupportedResult = Readonly<{
  ok: false;
  errorCode: 'unsupported_session_runtime_method';
  error: string;
}>;

export type CodexAppServerReviewStartResult = void | CodexAppServerReviewStartUnsupportedResult;
