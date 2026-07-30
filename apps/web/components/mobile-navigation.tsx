"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { HomeIcon, NotificationsIcon, SearchIcon, SettingsIcon } from "./component-icons";
import styles from "./product-components.module.css";

const ESSENTIAL_DESTINATIONS = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/notifications", label: "Alerts", icon: NotificationsIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

function isCurrentDestination(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileNavigation() {
  const pathname = usePathname();

  return (
    <nav className={styles.mobileNavigation} aria-label="Main navigation">
      <ul className={styles.mobileNavigationList}>
        {ESSENTIAL_DESTINATIONS.map(({ href, icon: Icon, label }) => {
          const isCurrent = isCurrentDestination(pathname, href);

          return (
            <li key={href}>
              <Link
                className={styles.mobileNavigationLink}
                data-current={isCurrent || undefined}
                href={href}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={isCurrent ? `${label}, current page` : label}
              >
                <Icon className={styles.mobileNavigationIcon} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
