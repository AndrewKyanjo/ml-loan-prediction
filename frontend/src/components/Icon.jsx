const paths = {
  chart: <><path d="M5 20V12M12 20V4M19 20V8" /><path d="M3 20h18" /></>,
  predict: <><path d="m13 3-8 11h6l-1 7 9-12h-6l1-6Z" /></>,
  batch: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></>,
  performance: <><path d="M4 18V6M4 18h16M7 14l4-6 4 3 5-7" /></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6" /></>,
  external: <><path d="M14 4h6v6m0-6-9 9" /><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
};

export default function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.chart}
    </svg>
  );
}
