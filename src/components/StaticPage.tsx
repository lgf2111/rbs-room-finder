/*
 * src/components/StaticPage.tsx
 *
 * Re-renders a native RBS static page (User Guide / FAQ / Support) inside the
 * nova shell by progressive enhancement: fetch the same-origin HTML, sanitise
 * it (src/lib/page-content), and render the cleaned node tree as React elements
 * on the dark surface. No raw HTML is inserted and no page script ever runs.
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { fetchPageContent, type CleanNode, type FetchedContent } from '@/lib/page-content';
import type { RouteInfo } from '@/lib/router';

/** Render a sanitised CleanNode tree as React elements (no dangerouslySetHTML). */
function renderNode(node: CleanNode, key: React.Key): React.ReactNode {
  if (node.type === 'text') return node.text;
  const children = node.children.map((c, i) => renderNode(c, i));
  return React.createElement(node.tag, { key }, children.length ? children : undefined);
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; content: FetchedContent }
  | { kind: 'error'; message: string };

export function StaticPage({
  route,
  onRevealNative,
}: {
  route: RouteInfo;
  onRevealNative: () => void;
}) {
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchPageContent(route.path)
      .then((content) => {
        if (!cancelled) setState({ kind: 'ready', content });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ kind: 'error', message: e.message || 'could not load this page' });
      });
    return () => {
      cancelled = true;
    };
  }, [route.path]);

  if (state.kind === 'loading') {
    return (
      <div
        className="flex h-full min-h-0 w-full items-center justify-center p-8 text-sm text-muted-foreground"
        data-testid="nova-static-loading"
      >
        Loading {route.title.toLowerCase()}…
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 p-8 text-center text-sm"
        data-testid="nova-static-error"
      >
        <div className="font-semibold text-foreground">{route.title}</div>
        <p className="max-w-md text-muted-foreground">
          Nova could not load this page ({state.message}). The untouched RBS page
          is one click away.
        </p>
        <Button onClick={onRevealNative} data-testid="nova-static-reveal">
          Show the native page
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full overflow-auto p-6" data-testid="nova-static">
      <article className="nova-prose mx-auto max-w-[760px]" data-testid="nova-static-content">
        {state.content.nodes.map((n, i) => renderNode(n, i))}
      </article>
    </div>
  );
}
