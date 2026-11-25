import { useState } from 'react';
import { Car } from 'lucide-react';
import { getVehicleCategoryImage } from '../../config/vehicleImages';
import { VEHICLE_CATEGORY_LABELS } from '../../config/vehicleCatalog';
import type { VehicleCategory } from '../../types/vehicle';

interface VehicleCardImageProps {
  category: VehicleCategory;
  alt: string;
  promoPercent?: number;
  plate?: string;
  className?: string;
}

export function VehicleCardImage({
  category,
  alt,
  promoPercent = 0,
  plate,
  className = '',
}: VehicleCardImageProps) {
  const [failed, setFailed] = useState(false);
  const src = getVehicleCategoryImage(category);
  const categoryLabel = VEHICLE_CATEGORY_LABELS[category] ?? category;

  return (
    <div
      className={`relative aspect-[4/3] w-full overflow-hidden border-b border-white/10 bg-[#070A10] ${className}`}
    >
      {!failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0B1019] text-slate-500">
          <Car className="h-9 w-9 text-amber-500/70" />
          <span className="text-[11px] font-medium uppercase tracking-wider">{categoryLabel}</span>
        </div>
      )}

      {/* Subtle bottom vignette for crisp legibility */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#090B10]/90 via-[#090B10]/35 to-transparent" />

      {/* Category & Plate strip */}
      <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-slate-200">
          {categoryLabel}
        </span>
        {plate && (
          <span className="border border-white/15 bg-[#090B10]/85 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-amber-400">
            {plate}
          </span>
        )}
      </div>

      {/* Promotional discount marker (only when an active promotion exists) */}
      {promoPercent > 0 && (
        <div className="pointer-events-none absolute top-2.5 right-2.5 bg-amber-500 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-950">
          -{promoPercent}%
        </div>
      )}
    </div>
  );
}
