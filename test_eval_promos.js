import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const safeParseJson = (field) => {
  if (!field) return {};
  if (typeof field === "string") {
    try {
      return JSON.parse(field);
    } catch (e) {
      return {};
    }
  }
  return field;
};

const mapDbPromotionToApp = (p) => {
  const fm = safeParseJson(p.filters_metadata || p.filtersmetadata);
  return {
    id: p.id,
    tenantId: p.tenant_id || p.tenantid,
    name: p.name || "",
    type: p.type || "BUY_X_PAY_Y",
    targetType: p.target_type || p.targettype || "PRODUCT",
    targetValue: p.target_value || p.targetvalue || "",
    buyX: p.buy_x || p.buyx,
    payY: p.pay_y || p.payy,
    lightningDiscountPercentage:
      p.lightning_discount_percentage || p.lightningdiscountpercentage,
    discountThresholds: p.discount_thresholds || p.discountthresholds || [],
    comboProducts: p.combo_products || p.comboproducts || [],
    comboDiscountPercentage:
      p.combo_discount_percentage || p.combodiscountpercentage,
    specificProductIds: p.specific_product_ids || p.specificproductids || [],
    filtersMetadata: fm,
    bundlePrice: p.bundle_price ?? fm?.bundlePrice,
    bundleSlots: p.bundle_slots ?? fm?.bundleSlots,
    highlightInCategoriesBar:
      p.highlight_in_categories_bar ?? fm?.highlightInCategoriesBar,
    highlightColor:
      p.highlight_color ?? fm?.highlightColor,
    highlightIcon:
      p.highlight_icon ?? fm?.highlightIcon,
    scheduleConfig: fm?.scheduleConfig,
    startDate: p.start_date || p.startdate,
    endDate: p.end_date || p.enddate,
    isActive: p.is_active !== false && p.isactive !== false,
    scope: p.scope || "SINGLE_STORE",
  };
};

const isPromotionActive = (p, now = new Date()) => {
  if (!p.isActive) return false;

  const start = p.startDate ? new Date(p.startDate) : null;
  let end = null;
  if (p.endDate) {
    if (p.type === "LIGHTNING_OFFER" || p.endDate.includes("T")) {
      end = new Date(p.endDate);
    } else {
      const [year, month, day] = p.endDate.split("T")[0].split("-");
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
};

async function run() {
  const { data: rawPromos, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("tenant_id", "farmaciatrevo");

  if (error) {
    console.error("Error:", error);
    return;
  }

  const mapped = rawPromos.map(mapDbPromotionToApp);
  console.log("Mapped results with status:");
  const now = new Date();
  mapped.forEach(p => {
    const active = isPromotionActive(p, now);
    console.log(`- Promotion: "${p.name}" (ID: ${p.id})`);
    console.log(`  isActive (DB): ${p.isActive}`);
    console.log(`  bundlePrice: ${p.bundlePrice}`);
    console.log(`  bundleSlots (length): ${p.bundleSlots?.length}`);
    console.log(`  startDate: ${p.startDate}`);
    console.log(`  endDate: ${p.endDate}`);
    console.log(`  isPromotionActive(now): ${active}`);
  });
}
run();
