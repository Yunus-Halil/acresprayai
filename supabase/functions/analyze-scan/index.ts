import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { imageUrl, cropType, fieldName } = await req.json();
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'imageUrl required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tool = {
      type: 'function',
      function: {
        name: 'report_crop_analysis',
        description: 'Return structured crop health analysis and spray recommendation.',
        parameters: {
          type: 'object',
          properties: {
            health_score: { type: 'integer', description: '0-100 overall crop health' },
            summary: { type: 'string', description: 'One paragraph summary for the farmer' },
            detections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['pest', 'weed', 'disease', 'nutrient_deficiency', 'healthy'] },
                  label: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  coverage_pct: { type: 'number' },
                  recommendation: { type: 'string' },
                },
                required: ['type', 'label', 'severity', 'coverage_pct', 'recommendation'],
              },
            },
            spray_plan: {
              type: 'object',
              properties: {
                recommended: { type: 'boolean' },
                chemical: { type: 'string' },
                dose_l_ha: { type: 'number' },
                target_area_pct: { type: 'number' },
                notes: { type: 'string' },
              },
              required: ['recommended', 'chemical', 'dose_l_ha', 'target_area_pct', 'notes'],
            },
          },
          required: ['health_score', 'summary', 'detections', 'spray_plan'],
        },
      },
    };

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are AgriPulse, an agronomy AI. Analyze aerial/close-up crop images for pests, weeds, disease, and nutrient stress. Always call report_crop_analysis with conservative, actionable spray recommendations using EU-compliant active ingredients. Prefer spot spraying over blanket treatment.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this crop image. Field: ${fieldName || 'unknown'}. Crop: ${cropType || 'unknown'}. Provide health score, detections, and a precision spray plan.` },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'report_crop_analysis' } },
      }),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: 'AI credits exhausted. Add credits in workspace settings.' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: 'AI gateway error', detail: t }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ error: 'No analysis returned' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const parsed = JSON.parse(call.function.arguments);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});