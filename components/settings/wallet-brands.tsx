import {
  siAmericanexpress,
  siChase,
  siMastercard,
  siVisa,
  siWellsfargo,
} from "simple-icons";
import type { CardNetwork } from "@/lib/settings/wallet-mock";

type SimpleIconData = { title: string; path: string };

function BrandSvg({ icon, className }: { icon: SimpleIconData; className?: string }) {
  return (
    <svg role="img" viewBox="0 0 24 24" className={className} aria-hidden>
      <title>{icon.title}</title>
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

export function IssuerLogo({ issuer, className }: { issuer: string; className?: string }) {
  if (issuer === "amex") return <BrandSvg icon={siAmericanexpress} className={className} />;
  if (issuer === "chase") return <BrandSvg icon={siChase} className={className} />;
  if (issuer === "wells_fargo") return <BrandSvg icon={siWellsfargo} className={className} />;
  if (issuer === "citi") return <CitiLogo className={className} />;
  if (issuer === "capital_one") return <CapitalOneLogo className={className} />;
  return <span className={className}>{issuer.replaceAll("_", " ")}</span>;
}

export function NetworkLogo({ network, className }: { network: CardNetwork; className?: string }) {
  if (network === "amex") return <BrandSvg icon={siAmericanexpress} className={className} />;
  if (network === "mastercard") return <BrandSvg icon={siMastercard} className={className} />;
  return <BrandSvg icon={siVisa} className={className} />;
}

function CitiLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 28" className={className} role="img" aria-hidden>
      <title>Citi</title>
      <path
        d="M8 20c7.5-14 48.5-14 56 0"
        fill="none"
        stroke="#E31937"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <text
        x="36"
        y="24"
        textAnchor="middle"
        fill="currentColor"
        fontSize="12"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        citi
      </text>
    </svg>
  );
}

function CapitalOneLogo({ className }: { className?: string }) {
  return <CapitalOneWordmark className={className} swoosh="red" />;
}

export function CapitalOneWordmark({
  className,
  swoosh = "silver",
}: {
  className?: string;
  swoosh?: "red" | "silver";
}) {
  return (
    <svg viewBox="0 0 168 32" className={className} role="img" aria-hidden>
      <title>Capital One</title>
      <text
        x="0"
        y="26"
        fill="currentColor"
        fontSize="15.5"
        fontFamily="Helvetica Neue, Helvetica, Arial, sans-serif"
      >
        <tspan fontWeight="700">Capital</tspan>
        <tspan fontWeight="400"> One</tspan>
      </text>
      <path
        d="M108 5.5c18-4.2 42-2.8 54 7.2"
        fill="none"
        stroke={swoosh === "red" ? "#E1261C" : "currentColor"}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmvChip({
  tone,
  chipId,
  className,
}: {
  tone: "silver" | "gold";
  chipId: string;
  className?: string;
}) {
  const fillId = `emv-${chipId}`;
  const stops =
    tone === "gold"
      ? [
          ["0%", "#f6e7c4"],
          ["48%", "#d4b46a"],
          ["100%", "#9a742c"],
        ]
      : [
          ["0%", "#f7f8fa"],
          ["42%", "#c8ced4"],
          ["100%", "#8a929b"],
        ];

  return (
    <svg viewBox="0 0 50 38" className={className} data-emv-chip aria-hidden>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          {stops.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <rect x="0.6" y="0.6" width="48.8" height="36.8" rx="5.5" fill={`url(#${fillId})`} stroke="rgba(0,0,0,0.22)" />
      <path
        d="M9 8.5 h13.5 v21 H9z M27.5 8.5 h13.5 v21 H27.5z M22.5 1.2 v35.6 M1.2 19 h47.6"
        fill="none"
        stroke="rgba(70,55,20,0.35)"
        strokeWidth="1.15"
      />
    </svg>
  );
}

export function BankBuildingMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} data-bank-mark aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 20 L24 7 L42 20" />
        <path d="M8 20 H40" />
        <rect x="11" y="22" width="6" height="13" rx="1.2" />
        <rect x="21" y="22" width="6" height="13" rx="1.2" />
        <rect x="31" y="22" width="6" height="13" rx="1.2" />
        <path d="M9 36 H39" />
        <path d="M6 40 H42" />
      </g>
    </svg>
  );
}

