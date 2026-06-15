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
            crop_type: { type: 'string', description: 'Best guess of crop visible (e.g. Wheat, Maize, Vineyard, Olive grove, Soy)' },
            field_layout: {
              type: 'string',
              enum: ['rows', 'orchard', 'pivot', 'terraced'],
              description: 'Field structure inferred from the image. rows=row crops (wheat/cereal/maize), orchard=spaced trees/vines, pivot=circular center-pivot irrigation, terraced=stepped/banded slopes.',
            },
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
            spray_zones: {
              type: 'array',
              description: 'Up to 5 problem zones positioned on the field. x in -12..12 (left-right), z in -8..8 (back-front), w/d are widths in same units (1-6).',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  z: { type: 'number' },
                  w: { type: 'number' },
                  d: { type: 'number' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  label: { type: 'string' },
                },
                required: ['x', 'z', 'w', 'd', 'severity', 'label'],
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
            likely_issues: {
              type: 'array',
              description: '3-6 short observations about what the image suggests could be wrong, inferred from colour, texture, canopy patterns, edges, and irrigation marks — even for a broad/low-resolution farm view. Each item is one sentence in plain language for a farmer.',
              items: { type: 'string' },
            },
          },
          required: ['health_score', 'summary', 'crop_type', 'field_layout', 'detections', 'spray_zones', 'spray_plan', 'likely_issues'],
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
            content: 'You are AcreSpray AI, an agronomy AI. Analyze aerial/close-up crop images for pests, weeds, disease, and nutrient stress. Always call report_crop_analysis with conservative, actionable spray recommendations using EU-compliant active ingredients. Prefer spot spraying over blanket treatment. From the image also infer the field layout (rows for cereals/maize, orchard for spaced trees/vines, pivot for circular center-pivot, terraced for stepped/banded slopes) and the crop type, and place 1-5 spray_zones positioned over the visible problem areas using the coordinate system in the schema. Even on broad or low-resolution farm-scale views where individual leaves are not visible, always produce 3-6 likely_issues by reasoning from colour (yellowing, browning, dark patches, grey waterlogging), texture (bare spots, uneven canopy, stripes), edges, headlands, and irrigation marks — phrased as plausible hypotheses for the farmer to verify.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this crop image. Field: ${fieldName || 'unknown'}. Crop hint: ${cropType || 'unknown'}. Return health, crop_type, field_layout, detections, spray_zones placed where problems are visible, and a spray_plan.` },
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