import * as React from 'react';

import { TopBar } from '@/components/TopBar';

/** Phase 1 app shell: the shadcn top bar only. The board lands in phase 2. */
export function App() {
  return (
    <div className="nova-root min-h-0 w-full">
      <TopBar />
    </div>
  );
}
