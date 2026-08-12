const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const targetStr = `    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    res.json(data || []);`;

const newStr = `    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false });
    
    if (error) throw error;

    // Fetch medical prescriptions for these orders
    const orderIds = (data || []).map(o => o.id);
    let prescriptionsMap = {};
    
    if (orderIds.length > 0) {
      const { data: prescriptions, error: rxError } = await supabaseAdmin
        .from("medical_prescriptions")
        .select("order_id, status")
        .eq("store_id", id)
        .in("order_id", orderIds);
        
      if (!rxError && prescriptions) {
        prescriptionsMap = prescriptions.reduce((acc, rx) => {
          if (rx.order_id) acc[rx.order_id] = rx.status;
          return acc;
        }, {});
      }
    }

    const enhancedData = (data || []).map(order => ({
      ...order,
      prescription_status: prescriptionsMap[order.id] || null
    }));

    res.json(enhancedData);`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('server.ts', code);
