import Image from "next/image";
import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Athenvia home">
      <Image className="brand-mark" src="/icons/mark.svg" alt="" width={36} height={36} />
      <span>Athenvia</span>
    </Link>
  );
}
