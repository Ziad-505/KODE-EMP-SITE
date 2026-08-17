const paths = {
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  news: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 5h8m-8 4h8m-8 4h5',
  calendar:
    'M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  shield: 'M12 3 19 6v5c0 4.5-3 7.4-7 10-4-2.6-7-5.5-7-10V6l7-3Zm-3.2 9 2.1 2.1 4.4-4.4',
  question: 'M9.1 9a3 3 0 1 1 5.7 1.4c-.8 1.4-2.8 1.8-2.8 3.6m0 3h.01',
  image: 'M4 5h16v14H4V5Zm1 11 4-4 3 3 2-2 5 5M8 9h.01',
  people:
    'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20m12-11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6 11v-1.5a4 4 0 0 0-3-3.9m-3-9.5a4 4 0 0 1 0 7.8',
  media: 'M4 5h16v14H4V5Zm2 3h12v8H6V8Zm2 10h8',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1m-1 8a5 5 0 0 1-7 0 5 5 0 0 1 0-7l2-2a5 5 0 0 1 7 0',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.8V20a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2-2 .1-.1A1.7 1.7 0 0 0 7.6 15a1.7 1.7 0 0 0-1.5-1H6v-2.8h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-2 .1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V5h2.8v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.1V14h-.1a1.7 1.7 0 0 0-1.5 1Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5m4-1v5l3 2',
  search: 'm21 21-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M5 20h14',
  external: 'M14 5h5v5m0-5-8 8m6 0v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5',
  trash:
    'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  key: 'M14 8a5 5 0 1 1-4.6 6.9L4 20.3 3 19.3l1.4-1.4-1-1 1.4-1.4-1-1 4.3-4.3A5 5 0 0 1 14 8Zm2 3h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V7a4 4 0 0 1 8 0v4',
} as const;

export type IconName = keyof typeof paths;

/** Unknown names throw in development instead of shipping an invisible button. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const d = paths[name];
  if (!d) {
    if (import.meta.env.DEV) throw new Error(`Unknown icon: ${String(name)}`);
    return null;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
