ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read on promotions" ON public.promotions;
CREATE POLICY "Public Read on promotions" ON public.promotions
FOR SELECT USING (
  true
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read on coupons" ON public.coupons;
CREATE POLICY "Public Read on coupons" ON public.coupons
FOR SELECT USING (
  true
);
