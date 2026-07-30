import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const commonProps = {
  "aria-hidden": true,
  fill: "none",
  focusable: false,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 1.8,
  viewBox: "0 0 24 24",
} as const;

export function HomeIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="m3.5 10.7 8.5-7 8.5 7" />
      <path d="M5.5 9.3v10h13v-10M9.5 19.3v-6h5v6" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

export function NotificationsIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 5.5 2.5 6 2.5 7.5H4c0-1.5 2.5-2 2.5-7.5Z" />
      <path d="M10 20h4" />
    </svg>
  );
}

export function ConfirmedIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.5 2.5L16.5 9" />
    </svg>
  );
}

export function ExpectedIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.3 2" />
    </svg>
  );
}

export function NotPublishedIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 6 2.5 6 2.5 7.5H4c0-1.5 2.5-1.5 2.5-7.5Z" />
      <path d="M10 20h4" />
    </svg>
  );
}

export function EmptyIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M4 8.5h16v10H4z" />
      <path d="m7 8.5 1.5-3h7l1.5 3M8 13h2a2 2 0 0 0 4 0h2" />
    </svg>
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <svg {...commonProps} {...props}>
      <path d="M19 8a8 8 0 1 0 .5 7" />
      <path d="M19 3v5h-5" />
    </svg>
  );
}
