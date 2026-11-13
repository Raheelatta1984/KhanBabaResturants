type IconProps = { name: IconName; size?: number; stroke?: number; className?: string };

const paths: Record<string, string> = {
  cart: "M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "M9 18l6-6-6-6",
  check: "M20 6L9 17l-5-5",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2",
  bike: "M5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm14 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5 15l4-7h6l3 7M9 8l-2-3H4m8 3 2 7",
  bag: "M6 8h12l1 12H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2",
  table: "M3 9h18M5 9v11m14-11v11M7 9V5h10v4",
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9 6.7 19.7l1.1-5.9L3.5 9.7l5.9-.8L12 3.5Z",
  flame: "M12 22c4 0 6-2.6 6-5.8 0-2.3-1.3-3.9-2.4-5.2C14.2 9.3 13.4 8 13.4 8c-.6 2.3-2 3.2-3.3 4.5C8.9 13.7 8 15 8 17.2 8 20 10 22 12 22Z",
  pin: "M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  phone: "M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 9a8 8 0 0 0-16 0",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  calendar: "M4 6h16v14H4V6Zm4-3v4m8-4v4M4 10h16",
  box: "M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Zm0 0v9m0 0 9-4.5M12 12 3 7.5",
  layers: "M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5",
  sparkle: "M12 3v5m0 8v5M3 12h5m8 0h5M6 6l3 3m6 6 3 3M18 6l-3 3m-6 6-3 3",
  play: "M8 5l11 7-11 7V5Z",
  edit: "M4 20h4l10-10-4-4L4 16v4Zm10-14 4 4",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  truck: "M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  chart: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 2Z",
};

export type IconName = keyof typeof paths | string;

export function Icon({ name, size = 18, stroke = 1.6, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.sparkle} />
    </svg>
  );
}
