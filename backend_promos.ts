// These endpoints will be added to server.ts

app.get("/api/v1/tenants/:tenantId/promos", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const networkId = req.query.networkId;
    
    let query = supabaseAdmin.from("promotions").select("*");
    if (networkId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      query = query.eq("tenant_id", tenantId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/promos", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const payload = req.body;
    // ensure tenant is matching
    if (payload.tenant_id !== tenantId) {
        return res.status(403).json({ error: "Tenant mismatch" });
    }
    const { data, error } = await supabaseAdmin.from("promotions").upsert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/:tenantId/promos/:id", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { error } = await supabaseAdmin.from("promotions").delete().eq("id", req.params.id).eq("tenant_id", tenantId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Vouchers (Coupons)
app.get("/api/v1/tenants/:tenantId/vouchers", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const networkId = req.query.networkId;
    
    let query = supabaseAdmin.from("coupons").select("*");
    if (networkId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      query = query.eq("tenant_id", tenantId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/vouchers", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const payload = req.body;
    if (payload.tenant_id !== tenantId) {
        return res.status(403).json({ error: "Tenant mismatch" });
    }
    const { data, error } = await supabaseAdmin.from("coupons").upsert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/:tenantId/vouchers/:id", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", req.params.id).eq("tenant_id", tenantId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

