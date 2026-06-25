export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anomalies: {
        Row: {
          ai_label: string | null
          ai_reasoning: string | null
          area_ha: number | null
          created_at: string
          id: string
          ndvi_mean: number | null
          ndvi_p10: number | null
          ndvi_p90: number | null
          orthomosaic_id: string | null
          polygon: unknown
          severity: string
          source: string
          status: string
          updated_at: string
          user_id: string
          user_label: string | null
          user_notes: string | null
          zone_id: string
        }
        Insert: {
          ai_label?: string | null
          ai_reasoning?: string | null
          area_ha?: number | null
          created_at?: string
          id?: string
          ndvi_mean?: number | null
          ndvi_p10?: number | null
          ndvi_p90?: number | null
          orthomosaic_id?: string | null
          polygon: unknown
          severity?: string
          source?: string
          status?: string
          updated_at?: string
          user_id: string
          user_label?: string | null
          user_notes?: string | null
          zone_id: string
        }
        Update: {
          ai_label?: string | null
          ai_reasoning?: string | null
          area_ha?: number | null
          created_at?: string
          id?: string
          ndvi_mean?: number | null
          ndvi_p10?: number | null
          ndvi_p90?: number | null
          orthomosaic_id?: string | null
          polygon?: unknown
          severity?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
          user_label?: string | null
          user_notes?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anomalies_orthomosaic_id_fkey"
            columns: ["orthomosaic_id"]
            isOneToOne: false
            referencedRelation: "orthomosaics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_orthomosaic_id_fkey"
            columns: ["orthomosaic_id"]
            isOneToOne: false
            referencedRelation: "orthomosaics_geo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "crop_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "crop_zones_geo"
            referencedColumns: ["id"]
          },
        ]
      }
      crop_zones: {
        Row: {
          area_ha: number | null
          created_at: string
          crop: string
          field_id: string
          id: string
          name: string
          notes: string | null
          planted_at: string | null
          polygon: unknown
          updated_at: string
          user_id: string
          variety: string | null
        }
        Insert: {
          area_ha?: number | null
          created_at?: string
          crop: string
          field_id: string
          id?: string
          name: string
          notes?: string | null
          planted_at?: string | null
          polygon: unknown
          updated_at?: string
          user_id: string
          variety?: string | null
        }
        Update: {
          area_ha?: number | null
          created_at?: string
          crop?: string
          field_id?: string
          id?: string
          name?: string
          notes?: string | null
          planted_at?: string | null
          polygon?: unknown
          updated_at?: string
          user_id?: string
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crop_zones_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      drones: {
        Row: {
          battery: number
          created_at: string
          health: number
          id: string
          model: string
          name: string
          signal: number
          status: string
          user_id: string
        }
        Insert: {
          battery?: number
          created_at?: string
          health?: number
          id?: string
          model?: string
          name: string
          signal?: number
          status?: string
          user_id: string
        }
        Update: {
          battery?: number
          created_at?: string
          health?: number
          id?: string
          model?: string
          name?: string
          signal?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      fields: {
        Row: {
          area_hectares: number
          boundary: Json | null
          boundary_area_hectares: number | null
          created_at: string
          crop: string
          id: string
          location: string | null
          name: string
          notes: string | null
          user_id: string
        }
        Insert: {
          area_hectares?: number
          boundary?: Json | null
          boundary_area_hectares?: number | null
          created_at?: string
          crop: string
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          user_id: string
        }
        Update: {
          area_hectares?: number
          boundary?: Json | null
          boundary_area_hectares?: number | null
          created_at?: string
          crop?: string
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          area_ha: number | null
          chemical: string | null
          created_at: string
          dose_l_ha: number | null
          drone_id: string | null
          field_id: string | null
          id: string
          notes: string | null
          scan_id: string | null
          scheduled_at: string
          status: string
          type: string
          user_id: string
        }
        Insert: {
          area_ha?: number | null
          chemical?: string | null
          created_at?: string
          dose_l_ha?: number | null
          drone_id?: string | null
          field_id?: string | null
          id?: string
          notes?: string | null
          scan_id?: string | null
          scheduled_at?: string
          status?: string
          type?: string
          user_id: string
        }
        Update: {
          area_ha?: number | null
          chemical?: string | null
          created_at?: string
          dose_l_ha?: number | null
          drone_id?: string | null
          field_id?: string | null
          id?: string
          notes?: string | null
          scan_id?: string | null
          scheduled_at?: string
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_drone_id_fkey"
            columns: ["drone_id"]
            isOneToOne: false
            referencedRelation: "drones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
      odm_tasks: {
        Row: {
          created_at: string
          error: string | null
          field_id: string
          id: string
          image_count: number
          odm_uuid: string | null
          ortho_path: string | null
          output_path: string | null
          progress: number
          status: string
          tiles_baked: boolean
          tiles_done: number
          tiles_max_zoom: number | null
          tiles_min_zoom: number | null
          tiles_total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          field_id: string
          id?: string
          image_count?: number
          odm_uuid?: string | null
          ortho_path?: string | null
          output_path?: string | null
          progress?: number
          status?: string
          tiles_baked?: boolean
          tiles_done?: number
          tiles_max_zoom?: number | null
          tiles_min_zoom?: number | null
          tiles_total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          field_id?: string
          id?: string
          image_count?: number
          odm_uuid?: string | null
          ortho_path?: string | null
          output_path?: string | null
          progress?: number
          status?: string
          tiles_baked?: boolean
          tiles_done?: number
          tiles_max_zoom?: number | null
          tiles_min_zoom?: number | null
          tiles_total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "odm_tasks_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      orthomosaics: {
        Row: {
          bounds: unknown
          captured_at: string | null
          center: unknown
          created_at: string
          error: string | null
          field_id: string | null
          gsd_m_per_px: number | null
          height_px: number | null
          id: string
          kind: string
          preview_path: string | null
          status: string
          storage_path: string
          thumbnail_path: string | null
          updated_at: string
          user_id: string
          width_px: number | null
        }
        Insert: {
          bounds?: unknown
          captured_at?: string | null
          center?: unknown
          created_at?: string
          error?: string | null
          field_id?: string | null
          gsd_m_per_px?: number | null
          height_px?: number | null
          id?: string
          kind?: string
          preview_path?: string | null
          status?: string
          storage_path: string
          thumbnail_path?: string | null
          updated_at?: string
          user_id: string
          width_px?: number | null
        }
        Update: {
          bounds?: unknown
          captured_at?: string | null
          center?: unknown
          created_at?: string
          error?: string | null
          field_id?: string | null
          gsd_m_per_px?: number | null
          height_px?: number | null
          id?: string
          kind?: string
          preview_path?: string | null
          status?: string
          storage_path?: string
          thumbnail_path?: string | null
          updated_at?: string
          user_id?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orthomosaics_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_signups: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          farm_name: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          farm_name?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          farm_name?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      scans: {
        Row: {
          ai_summary: string | null
          created_at: string
          detections: Json | null
          field_id: string
          health_score: number | null
          id: string
          image_path: string | null
          status: string
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          detections?: Json | null
          field_id: string
          health_score?: number | null
          id?: string
          image_path?: string | null
          status?: string
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          detections?: Json | null
          field_id?: string
          health_score?: number | null
          id?: string
          image_path?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scans_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      spray_recommendations: {
        Row: {
          anomaly_id: string
          chemical: string
          chemical_class: string | null
          created_at: string
          dose_l_ha: number
          id: string
          job_id: string | null
          rationale: string | null
          status: string
          target_polygon: unknown
          total_l: number | null
          updated_at: string
          user_id: string
          weather_window_end: string | null
          weather_window_start: string | null
        }
        Insert: {
          anomaly_id: string
          chemical: string
          chemical_class?: string | null
          created_at?: string
          dose_l_ha: number
          id?: string
          job_id?: string | null
          rationale?: string | null
          status?: string
          target_polygon?: unknown
          total_l?: number | null
          updated_at?: string
          user_id: string
          weather_window_end?: string | null
          weather_window_start?: string | null
        }
        Update: {
          anomaly_id?: string
          chemical?: string
          chemical_class?: string | null
          created_at?: string
          dose_l_ha?: number
          id?: string
          job_id?: string | null
          rationale?: string | null
          status?: string
          target_polygon?: unknown
          total_l?: number | null
          updated_at?: string
          user_id?: string
          weather_window_end?: string | null
          weather_window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spray_recommendations_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "anomalies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spray_recommendations_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "anomalies_geo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spray_recommendations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      anomalies_geo: {
        Row: {
          ai_label: string | null
          ai_reasoning: string | null
          area_ha: number | null
          created_at: string | null
          geojson: Json | null
          id: string | null
          ndvi_mean: number | null
          ndvi_p10: number | null
          ndvi_p90: number | null
          orthomosaic_id: string | null
          severity: string | null
          source: string | null
          status: string | null
          user_id: string | null
          user_label: string | null
          user_notes: string | null
          zone_id: string | null
        }
        Insert: {
          ai_label?: string | null
          ai_reasoning?: string | null
          area_ha?: number | null
          created_at?: string | null
          geojson?: never
          id?: string | null
          ndvi_mean?: number | null
          ndvi_p10?: number | null
          ndvi_p90?: number | null
          orthomosaic_id?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          user_id?: string | null
          user_label?: string | null
          user_notes?: string | null
          zone_id?: string | null
        }
        Update: {
          ai_label?: string | null
          ai_reasoning?: string | null
          area_ha?: number | null
          created_at?: string | null
          geojson?: never
          id?: string | null
          ndvi_mean?: number | null
          ndvi_p10?: number | null
          ndvi_p90?: number | null
          orthomosaic_id?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          user_id?: string | null
          user_label?: string | null
          user_notes?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anomalies_orthomosaic_id_fkey"
            columns: ["orthomosaic_id"]
            isOneToOne: false
            referencedRelation: "orthomosaics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_orthomosaic_id_fkey"
            columns: ["orthomosaic_id"]
            isOneToOne: false
            referencedRelation: "orthomosaics_geo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "crop_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "crop_zones_geo"
            referencedColumns: ["id"]
          },
        ]
      }
      crop_zones_geo: {
        Row: {
          area_ha: number | null
          created_at: string | null
          crop: string | null
          field_id: string | null
          geojson: Json | null
          id: string | null
          name: string | null
          notes: string | null
          planted_at: string | null
          user_id: string | null
          variety: string | null
        }
        Insert: {
          area_ha?: number | null
          created_at?: string | null
          crop?: string | null
          field_id?: string | null
          geojson?: never
          id?: string | null
          name?: string | null
          notes?: string | null
          planted_at?: string | null
          user_id?: string | null
          variety?: string | null
        }
        Update: {
          area_ha?: number | null
          created_at?: string | null
          crop?: string | null
          field_id?: string | null
          geojson?: never
          id?: string | null
          name?: string | null
          notes?: string | null
          planted_at?: string | null
          user_id?: string | null
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crop_zones_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      orthomosaics_geo: {
        Row: {
          captured_at: string | null
          created_at: string | null
          east: number | null
          field_id: string | null
          gsd_m_per_px: number | null
          height_px: number | null
          id: string | null
          kind: string | null
          north: number | null
          south: number | null
          status: string | null
          storage_path: string | null
          user_id: string | null
          west: number | null
          width_px: number | null
        }
        Insert: {
          captured_at?: string | null
          created_at?: string | null
          east?: never
          field_id?: string | null
          gsd_m_per_px?: number | null
          height_px?: number | null
          id?: string | null
          kind?: string | null
          north?: never
          south?: never
          status?: string | null
          storage_path?: string | null
          user_id?: string | null
          west?: never
          width_px?: number | null
        }
        Update: {
          captured_at?: string | null
          created_at?: string | null
          east?: never
          field_id?: string | null
          gsd_m_per_px?: number | null
          height_px?: number | null
          id?: string | null
          kind?: string | null
          north?: never
          south?: never
          status?: string | null
          storage_path?: string | null
          user_id?: string | null
          west?: never
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orthomosaics_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      create_anomaly: {
        Args: {
          p_ai_label: string
          p_ai_reasoning: string
          p_ndvi_mean: number
          p_ndvi_p10: number
          p_ndvi_p90: number
          p_orthomosaic_id: string
          p_polygon: Json
          p_severity: string
          p_source?: string
          p_zone_id: string
        }
        Returns: string
      }
      create_crop_zone: {
        Args: {
          p_crop: string
          p_field_id: string
          p_name: string
          p_notes?: string
          p_planted_at?: string
          p_polygon: Json
          p_variety: string
        }
        Returns: string
      }
      create_spray_recommendation: {
        Args: {
          p_anomaly_id: string
          p_chemical: string
          p_chemical_class: string
          p_dose_l_ha: number
          p_rationale: string
          p_total_l: number
        }
        Returns: string
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_crop_zone: {
        Args: { p_id: string; p_polygon: Json }
        Returns: undefined
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
