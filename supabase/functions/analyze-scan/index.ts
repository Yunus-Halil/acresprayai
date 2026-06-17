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
            summary: { type: 'string', description: 'One paragraph summary for the farmer, written as observations and hypotheses, not assertions. Use hedged language ("may indicate", "could be associated with", "visual variation detected"). Never claim a specific disease, pest, or deficiency unless clearly visible.' },
            crop_type: { type: 'string', description: 'Best inference of crop visible, or "Unable to determine from imagery alone" if not confidently identifiable. Prefix tentative guesses with "Possibly ".' },
            field_layout: {
              type: 'string',
              enum: ['rows', 'orchard', 'pivot', 'terraced'],
              description: 'Field structure inferred from the image. rows=row crops (wheat/cereal/maize), orchard=spaced trees/vines, pivot=circular center-pivot irrigation, terraced=stepped/banded slopes.',
            },
            detections: {
              type: 'array',
              description: 'Only include detections that are visually defensible from the image. If nothing can be reliably identified, return an empty array. Labels should be observational (e.g. "Yellowing patch", "Bare soil area", "Possible canopy stress") rather than definitive diagnoses unless clearly supported.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['pest', 'weed', 'disease', 'nutrient_deficiency', 'healthy'] },
                  label: { type: 'string', description: 'Observational label. Use hedged phrasing ("Possible ...", "Visual variation ...") unless the issue is unmistakable in the image.' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  coverage_pct: { type: 'number', description: 'Approximate visible coverage percentage. Only estimate when the area is clearly bounded in the image; otherwise use a conservative low value and note uncertainty in the recommendation.' },
                  recommendation: { type: 'string', description: 'Conservative next step. Prefer "Inspect on the ground" or "Additional data would be required" over specific chemical prescriptions unless the issue is clearly supported by the image.' },
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
              description: 'Only recommend spraying when the image clearly supports it. If evidence is insufficient, set recommended=false, chemical="None - additional data required", dose_l_ha=0, target_area_pct=0, and explain in notes.',
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
              description: '3-6 short OBSERVATIONS (not diagnoses) about what the image may suggest, inferred from colour, texture, canopy patterns, edges, and irrigation marks. Each item must be phrased as a hypothesis to verify, using language like "May indicate ...", "Could be associated with ...", "Visual variation detected ...", "Unable to determine from imagery alone ...". Never assert a specific disease, pest, or deficiency as fact.',
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
            content: [
              'You are AcreSpray AI, an agronomy vision assistant. Follow this Accuracy and Reliability Policy strictly:',
              '',
              'GOLDEN RULE: If a claim cannot be defended using the image provided, do not state it as fact. Report observations, not assumptions. Quantify only what can be measured from the image. Label everything else as a hypothesis requiring verification.',
              '',
              'Never:',
              '- Claim to identify specific diseases, pests, nutrient deficiencies, weeds, or crop varieties unless directly and unmistakably supported by the image.',
              '- Invent measurements, coordinates, acreage, savings estimates, chemical recommendations, weather conditions, regulatory status, or confidence scores without a verifiable basis.',
              '- Present assumptions as facts.',
              '',
              'Prefer hedged phrasing: "Visual variation detected", "Potential anomaly observed", "May indicate", "Could be associated with", "Unable to determine from imagery alone", "Additional data would be required".',
              '',
              'Be conservative. A limited but defensible observation is better than a detailed claim that cannot be supported. If the image is too broad, blurry, or ambiguous to support a finding, say so and return empty detections / empty spray_zones / recommended=false.',
              '',
              'When you do call report_crop_analysis: infer field_layout and crop_type only if visually defensible (otherwise use "Unable to determine from imagery alone"). Place spray_zones only over areas with clear visual anomalies. Never recommend a specific chemical unless the issue is clearly supported by the image - default to inspection / more data instead.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this crop image conservatively under the Accuracy and Reliability Policy. Field: ${fieldName || 'unknown'}. Crop hint: ${cropType || 'unknown'}. Report only what is visually defensible. Phrase uncertain findings as hypotheses ("may indicate", "could be associated with", "unable to determine from imagery alone"). If evidence is insufficient, return empty detections, empty spray_zones, and recommended=false with an explanation.` },
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