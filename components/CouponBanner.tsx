import React, { useState, useEffect } from 'react';
import { CouponRule, PromotionRule, isPromotionActive } from '../types';
import { Tag, X, Copy, Check, ExternalLink, Zap, Timer } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface CouponBannerProps {
  coupons: CouponRule[];
  promotions?: PromotionRule[];
  onFilterByCoupon?: (coupon: CouponRule) => void;
  onFilterByPromotion?: (promotion: PromotionRule) => void;
  backgroundColor?: string;
  onExpire?: () => void;
  compact?: boolean;
  isSticky?: boolean;
}

export const CouponBanner: React.FC<CouponBannerProps> = ({
  coupons,
  promotions = [],
  onFilterByCoupon,
  onFilterByPromotion,
  backgroundColor,
  onExpire,
  compact = false,
  isSticky = false,
}) => {
  const [activeCoupon, setActiveCoupon] = useState<CouponRule | null>(null);
  const [activeLightningOffer, setActiveLightningOffer] =
    useState<PromotionRule | null>(null);
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const checkActiveOffers = () => {
      const now = new Date();

      // Check for Lightning Offer first
      let validLightningOffer: PromotionRule | null = null;
      let offerEndTime: number | null = null;

      for (const p of promotions) {
        if (p.type === 'LIGHTNING_OFFER' && isPromotionActive(p, now)) {
          validLightningOffer = p;
          let end = p.endDate ? new Date(p.endDate) : null;

          if (
            p.scheduleConfig &&
            typeof p.scheduleConfig === "object" &&
            typeof p.scheduleConfig.startTime === "string" &&
            typeof p.scheduleConfig.endTime === "string" &&
            p.scheduleConfig.startTime.includes(":") &&
            p.scheduleConfig.endTime.includes(":")
          ) {
            const spFormatter = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Sao_Paulo',
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            const parts = spFormatter.formatToParts(now);
            const getP = (type: string) =>
              parts.find((pt) => pt.type === type)?.value || '';

            const currentHourRaw = parseInt(getP('hour'), 10) || now.getHours();
            const currentHour = currentHourRaw === 24 ? 0 : currentHourRaw;
            const currentMinute = parseInt(getP('minute'), 10) || now.getMinutes();
            const currentSecond = parseInt(getP('second'), 10) || now.getSeconds();

            const [startH, startM] = (p.scheduleConfig.startTime || "00:00").split(':').map(Number);
            const [endH, endM] = (p.scheduleConfig.endTime || "23:59").split(':').map(Number);

            const currentSeconds =
              currentHour * 3600 + currentMinute * 60 + currentSecond;
            const startSeconds = startH * 3600 + (startM || 0) * 60;
            const endSeconds = endH * 3600 + (endM || 0) * 60;

            let msRemaining = 0;
            if (startSeconds > endSeconds) {
              if (currentSeconds >= startSeconds) {
                msRemaining = (24 * 3600 - currentSeconds + endSeconds) * 1000;
              } else {
                msRemaining = (endSeconds - currentSeconds) * 1000;
              }
            } else {
              msRemaining = (endSeconds - currentSeconds) * 1000;
            }

            offerEndTime = now.getTime() + msRemaining;
            if (end && offerEndTime > end.getTime()) {
              offerEndTime = end.getTime();
            }
          } else {
            if (end) offerEndTime = end.getTime();
          }
          break;
        }
      }

      if (validLightningOffer) {
        setActiveLightningOffer(validLightningOffer);
        setActiveCoupon(null);

        if (offerEndTime) {
          const timeRemaining = offerEndTime - now.getTime();
          if (timeRemaining > 0) {
            setTimeLeft({
              hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
              minutes: Math.floor(
                (timeRemaining % (1000 * 60 * 60)) / (1000 * 60),
              ),
              seconds: Math.floor((timeRemaining % (1000 * 60)) / 1000),
            });
          } else {
            if (activeLightningOffer !== null) onExpire?.();
            setActiveLightningOffer(null);
          }
        } else {
          setTimeLeft(null); // No end time configured, but it's active.
        }
      } else {
        if (activeLightningOffer !== null) onExpire?.();
        setActiveLightningOffer(null);
        setTimeLeft(null);

        // Find the first active coupon
        const validCoupon = coupons.find((coupon) => {
          if (!coupon.isActive) return false;
          const start = coupon.startDate ? new Date(coupon.startDate) : null;
          let end = null;
          if (coupon.endDate) {
            if (coupon.endDate.includes("T")) {
              end = new Date(coupon.endDate);
            } else {
              const [year, month, day] = coupon.endDate.split("-");
              end = new Date(
                Number(year),
                Number(month) - 1,
                Number(day),
                23,
                59,
                59,
                999,
              );
            }
          }
          if (start && now < start) return false;
          if (end && now > end) return false;
          return true;
        });
        setActiveCoupon(validCoupon || null);
      }
    };

    checkActiveOffers();
    const interval = setInterval(checkActiveOffers, 1000);
    return () => clearInterval(interval);
  }, [coupons, promotions]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeCoupon) {
      navigator.clipboard.writeText(activeCoupon.code);
      setCopied(true);
      toast.success("Cupom copiado!");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isLightningValid = activeLightningOffer && (promotions || []).some(p => p.id === activeLightningOffer.id);
  const isCouponValid = activeCoupon && (coupons || []).some(c => c.id === activeCoupon.id);

  if (!isCouponValid && !isLightningValid) return null;

  return (
    <div
      className={`w-full flex flex-col lg:flex-row transition-all duration-300 ease-in-out relative z-10 ${
        compact
          ? "shadow-sm border-b border-black/10"
          : "shadow-sm animate-in slide-in-from-top-4"
      }`}
    >
      {isLightningValid && activeLightningOffer && (
        <div
          className={`flex-1 px-4 ${
            compact ? "py-2 sm:py-2.5" : "py-3 sm:py-4 lg:py-4"
          } lg:px-8 flex items-center justify-between text-xs sm:text-sm font-medium overflow-hidden bg-gradient-to-r from-red-600 to-orange-500 text-white transition-all duration-300 ease-in-out`}
          onClick={() => onFilterByPromotion?.(activeLightningOffer)}
        >
          <div className="flex items-center justify-between w-full mx-auto gap-3 lg:gap-6 cursor-pointer hover:opacity-95 transition-opacity group">
            <div className="flex items-center gap-2 text-left min-w-0">
              <strong
                className={`font-black tracking-wide uppercase ${
                  compact ? "text-[12px] sm:text-sm" : "text-[12px] sm:text-sm lg:text-xl"
                } shrink-0 leading-tight flex items-center gap-1.5`}
              >
                <Zap size={compact ? 15 : 18} className="animate-pulse shrink-0" />
                <span>OFERTA RELÂMPAGO:</span>
              </strong>
              <span
                className={`font-bold opacity-90 ${
                  compact
                    ? "text-[11px] sm:text-xs truncate"
                    : "text-[11px] sm:text-sm lg:text-lg"
                } leading-tight`}
              >
                {activeLightningOffer.lightningDiscountPercentage
                  ? `Aproveite ${activeLightningOffer.lightningDiscountPercentage}% OFF em produtos selecionados!`
                  : activeLightningOffer.buyX && activeLightningOffer.payY
                    ? `Aproveite ${activeLightningOffer.buyX} un. por apenas R$ ${activeLightningOffer.payY.toFixed(2)}!`
                    : `Aproveite ofertas especiais em produtos selecionados!`}
              </span>
            </div>

            {timeLeft && (
              <div className="flex items-center justify-end gap-2 shrink-0">
                <span
                  className={`text-[10px] sm:text-xs font-semibold opacity-90 uppercase tracking-wider ${
                    compact ? "hidden sm:inline" : "hidden lg:inline"
                  }`}
                >
                  Termina em:
                </span>
                <div
                  className={`flex items-center gap-1.5 bg-black/20 ${
                    compact
                      ? "px-2.5 py-1 text-[11px] sm:text-xs"
                      : "px-4 py-2 lg:px-5 lg:py-2 text-[12px] sm:text-sm lg:text-lg"
                  } rounded-full border border-white/20`}
                >
                  <Timer size={compact ? 13 : 16} className="animate-pulse opacity-80" />
                  <span className="font-black tabular-nums tracking-widest">
                    {String(timeLeft.hours).padStart(2, "0")}:
                    {String(timeLeft.minutes).padStart(2, "0")}:
                    {String(timeLeft.seconds).padStart(2, "0")}
                  </span>
                </div>
                {compact && (
                  <span className="hidden md:inline-flex items-center text-xs font-black underline decoration-white/50 hover:decoration-white ml-1">
                    Ver Ofertas <ExternalLink size={12} className="ml-1" />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isCouponValid && activeCoupon && (
        <div
          className={`px-4 ${
            compact ? "py-2 sm:py-2.5" : "py-3 sm:py-4 lg:py-4"
          } lg:px-6 flex items-center justify-between text-xs sm:text-sm font-medium overflow-hidden text-white transition-all duration-300 ease-in-out ${
            isLightningValid && activeLightningOffer ? "lg:w-[40%] bg-emerald-600" : "w-full flex-1"
          }`}
          style={
            !(isLightningValid && activeLightningOffer) && backgroundColor
              ? { backgroundColor }
              : (isLightningValid && activeLightningOffer)
                ? {}
                : { backgroundColor: "#10b981" }
          }
          onClick={() => onFilterByCoupon?.(activeCoupon)}
        >
          <div className="w-full flex items-center justify-between lg:justify-center cursor-pointer hover:opacity-90 transition-opacity group">
            <div className="flex items-center justify-between lg:justify-center text-left lg:text-center w-full gap-2 lg:gap-6">
              <strong
                className={`font-black tracking-wide uppercase ${
                  compact ? "text-[11px] sm:text-xs" : "text-[12px] sm:text-sm lg:text-lg"
                } truncate`}
              >
                🎁 GANHE{" "}
                {activeCoupon.discountType === "PERCENTAGE"
                  ? `${activeCoupon.discountValue}%`
                  : `R$ ${activeCoupon.discountValue.toFixed(2)}`}{" "}
                OFF
              </strong>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCopy}
                  className={`bg-white/20 hover:bg-white/30 ${
                    compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 lg:px-4 lg:py-1.5 text-xs sm:text-sm lg:text-base"
                  } rounded-md font-black tracking-wider flex items-center gap-1.5 transition-all border border-white/10 group-hover:border-white/40 shadow-sm`}
                  title="Clique para copiar"
                >
                  {activeCoupon.code}
                  {copied ? (
                    <Check size={compact ? 12 : 16} className="text-white" />
                  ) : (
                    <Copy size={compact ? 12 : 16} className="text-white/70" />
                  )}
                </button>

                {activeCoupon.targetType !== "ALL" && !compact && (
                  <a
                    href={`#produtos-cupom`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onFilterByCoupon?.(activeCoupon);
                    }}
                    className="text-[11px] sm:text-sm lg:text-base font-bold underline decoration-white/50 underline-offset-4 hover:decoration-white hover:opacity-100 opacity-90 transition-all whitespace-nowrap hidden sm:inline"
                  >
                    👉 Ver produtos
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CouponBanner;
