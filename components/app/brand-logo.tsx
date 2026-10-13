import { useId } from "react";

/** 智学慧教品牌 Logo：蓝底圆角徽章 + 打开的书 + 金色智慧火花（渐变取自图表调色板蓝 400→700 / 金色 s4） */
export function BrandLogo({ size = 32, className }: { size?: number; className?: string }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`zl-${gid}`} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3987e5" />
          <stop offset="1" stopColor="#104281" />
        </linearGradient>
      </defs>
      {/* 徽章底 */}
      <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill={`url(#zl-${gid})`} />
      {/* 打开的书（两页 + 书脊） */}
      <path
        d="M24 15.6c-3.2-2.9-7.7-4.1-12.3-4.1v21.2c4.6 0 9.1.9 12.3 3.7 3.2-2.8 7.7-3.7 12.3-3.7V11.5c-4.6 0-9.1 1.2-12.3 4.1z"
        fill="#fff"
        fillOpacity="0.22"
      />
      <path d="M11.7 12.3c-1.2-.5-2.7-.8-4.2-.8v21.2c1.5 0 3 .3 4.2.8z" fill="#fff" />
      <path d="M36.3 12.3c1.2-.5 2.7-.8 4.2-.8v21.2c-1.5 0-3 .3-4.2.8z" fill="#fff" fillOpacity="0.92" />
      <path d="M24 14.6v24.4" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />
      {/* 金色智慧火花 */}
      <path
        d="M35.5 4.2l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"
        fill="#eda100"
      />
      <path
        d="M31.2 12.9l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"
        fill="#eda100"
        fillOpacity="0.85"
      />
    </svg>
  );
}
