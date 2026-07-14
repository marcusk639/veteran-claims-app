"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1>Something went wrong</h1>
      <p>
        This wasn&apos;t supposed to happen. Try again, or come back in a moment
        if the problem continues.
      </p>
      <button type="button" onClick={() => unstable_retry()}>
        Try again
      </button>
    </main>
  );
}
