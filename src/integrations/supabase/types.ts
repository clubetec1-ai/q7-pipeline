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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_configs: {
        Row: {
          created_at: string
          enabled: boolean
          followup_inactivity_minutes: number | null
          followup_max_per_conversation: number
          groq_api_key: string | null
          groq_model: string
          organization_id: string
          system_prompt: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          followup_inactivity_minutes?: number | null
          followup_max_per_conversation?: number
          groq_api_key?: string | null
          groq_model?: string
          organization_id: string
          system_prompt?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          followup_inactivity_minutes?: number | null
          followup_max_per_conversation?: number
          groq_api_key?: string | null
          groq_model?: string
          organization_id?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_presence: {
        Row: {
          last_assigned_at: string | null
          last_seen_at: string | null
          max_concurrent: number | null
          organization_id: string
          pause_reason_id: string | null
          status: string
          status_since: string
          user_id: string
        }
        Insert: {
          last_assigned_at?: string | null
          last_seen_at?: string | null
          max_concurrent?: number | null
          organization_id: string
          pause_reason_id?: string | null
          status?: string
          status_since?: string
          user_id: string
        }
        Update: {
          last_assigned_at?: string | null
          last_seen_at?: string | null
          max_concurrent?: number | null
          organization_id?: string
          pause_reason_id?: string | null
          status?: string
          status_since?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_presence_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "agent_presence_pause_reason_id_organization_id_fkey"
            columns: ["pause_reason_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pause_reasons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      ai_usage_daily: {
        Row: {
          audio_calls: number
          calls: number
          day: string
          organization_id: string
          provider: string
          source: string
          tokens_in: number
          tokens_out: number
        }
        Insert: {
          audio_calls?: number
          calls?: number
          day?: string
          organization_id: string
          provider: string
          source: string
          tokens_in?: number
          tokens_out?: number
        }
        Update: {
          audio_calls?: number
          calls?: number
          day?: string
          organization_id?: string
          provider?: string
          source?: string
          tokens_in?: number
          tokens_out?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          organization_id: string
          prefix: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          organization_id: string
          prefix: string
          revoked_at?: string | null
          scopes: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      area_goals: {
        Row: {
          alerted_at: string | null
          approved_by: string | null
          area_id: string
          baseline: number | null
          created_at: string
          created_by: string | null
          direction: string
          ends_on: string | null
          id: string
          metric_key: string
          organization_id: string
          period: string
          source: string
          starts_on: string
          status: string
          target: number
          title: string
          updated_at: string
        }
        Insert: {
          alerted_at?: string | null
          approved_by?: string | null
          area_id: string
          baseline?: number | null
          created_at?: string
          created_by?: string | null
          direction: string
          ends_on?: string | null
          id?: string
          metric_key: string
          organization_id: string
          period?: string
          source?: string
          starts_on?: string
          status?: string
          target: number
          title: string
          updated_at?: string
        }
        Update: {
          alerted_at?: string | null
          approved_by?: string | null
          area_id?: string
          baseline?: number | null
          created_at?: string
          created_by?: string | null
          direction?: string
          ends_on?: string | null
          id?: string
          metric_key?: string
          organization_id?: string
          period?: string
          source?: string
          starts_on?: string
          status?: string
          target?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_goals_area_fk"
            columns: ["area_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "org_areas"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "area_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      area_metric_snapshots: {
        Row: {
          area_id: string
          created_at: string
          metric_key: string
          organization_id: string
          period_start: string
          value: number | null
        }
        Insert: {
          area_id: string
          created_at?: string
          metric_key: string
          organization_id: string
          period_start: string
          value?: number | null
        }
        Update: {
          area_id?: string
          created_at?: string
          metric_key?: string
          organization_id?: string
          period_start?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "area_metric_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_snapshots_area_fk"
            columns: ["area_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "org_areas"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          agent_key: string | null
          created_at: string
          id: number
          meta: Json
          organization_id: string | null
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          agent_key?: string | null
          created_at?: string
          id?: never
          meta?: Json
          organization_id?: string | null
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          agent_key?: string | null
          created_at?: string
          id?: never
          meta?: Json
          organization_id?: string | null
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          event: string
          id: string
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id: string
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_runs: {
        Row: {
          calls: number
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          model: string | null
          organization_id: string
          packet_hash: string | null
          period_start: string
          started_at: string
          status: string
          summary: Json | null
          tokens_in: number
          tokens_out: number
          triggered_by: string | null
        }
        Insert: {
          calls?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          model?: string | null
          organization_id: string
          packet_hash?: string | null
          period_start?: string
          started_at?: string
          status?: string
          summary?: Json | null
          tokens_in?: number
          tokens_out?: number
          triggered_by?: string | null
        }
        Update: {
          calls?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          model?: string | null
          organization_id?: string
          packet_hash?: string | null
          period_start?: string
          started_at?: string
          status?: string
          summary?: Json | null
          tokens_in?: number
          tokens_out?: number
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brain_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          answered_at: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          duration_s: number | null
          ended_at: string | null
          extension_id: string | null
          id: string
          organization_id: string
          phone: string
          provider_call_id: string | null
          recording_url: string | null
          source: string
          started_at: string
          status: string
          user_id: string | null
        }
        Insert: {
          answered_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: string
          duration_s?: number | null
          ended_at?: string | null
          extension_id?: string | null
          id?: string
          organization_id: string
          phone: string
          provider_call_id?: string | null
          recording_url?: string | null
          source: string
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          answered_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          duration_s?: number | null
          ended_at?: string | null
          extension_id?: string | null
          id?: string
          organization_id?: string
          phone?: string
          provider_call_id?: string | null
          recording_url?: string | null
          source?: string
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_contact_id_organization_id_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_extension_id_organization_id_fkey"
            columns: ["extension_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pbx_extensions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          contact_id: string
          error: string | null
          id: number
          name: string | null
          organization_id: string
          phone: string
          sent_at: string | null
          status: string
          variant: string
        }
        Insert: {
          campaign_id: string
          contact_id: string
          error?: string | null
          id?: never
          name?: string | null
          organization_id: string
          phone: string
          sent_at?: string | null
          status?: string
          variant?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          error?: string | null
          id?: never
          name?: string | null
          organization_id?: string
          phone?: string
          sent_at?: string | null
          status?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_organization_id_fkey"
            columns: ["campaign_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_organization_id_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          failed: number
          finished_at: string | null
          group_ids: string[]
          id: string
          instance_id: string | null
          library_file_id: string | null
          message: string | null
          message_b: string | null
          name: string
          organization_id: string
          rate_per_min: number
          scheduled_at: string | null
          sent: number
          skipped: number
          started_at: string | null
          status: string
          template_lang: string | null
          template_name: string | null
          template_name_b: string | null
          total: number
          window_end: number
          window_start: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          failed?: number
          finished_at?: string | null
          group_ids?: string[]
          id?: string
          instance_id?: string | null
          library_file_id?: string | null
          message?: string | null
          message_b?: string | null
          name: string
          organization_id: string
          rate_per_min?: number
          scheduled_at?: string | null
          sent?: number
          skipped?: number
          started_at?: string | null
          status?: string
          template_lang?: string | null
          template_name?: string | null
          template_name_b?: string | null
          total?: number
          window_end?: number
          window_start?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          failed?: number
          finished_at?: string | null
          group_ids?: string[]
          id?: string
          instance_id?: string | null
          library_file_id?: string | null
          message?: string | null
          message_b?: string | null
          name?: string
          organization_id?: string
          rate_per_min?: number
          scheduled_at?: string | null
          sent?: number
          skipped?: number
          started_at?: string | null
          status?: string
          template_lang?: string | null
          template_name?: string | null
          template_name_b?: string | null
          total?: number
          window_end?: number
          window_start?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_instance_fk"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_instance_id_same_org"
            columns: ["instance_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "campaigns_library_file_id_fkey"
            columns: ["library_file_id"]
            isOneToOne: false
            referencedRelation: "library_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      charges: {
        Row: {
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string
          id: string
          invoice_url: string | null
          organization_id: string
          paid_at: string | null
          pix_code: string | null
          provider: string
          provider_id: string
          reminded_after: boolean
          reminded_before: boolean
          status: string
          value: number
        }
        Insert: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date: string
          id?: string
          invoice_url?: string | null
          organization_id: string
          paid_at?: string | null
          pix_code?: string | null
          provider?: string
          provider_id: string
          reminded_after?: boolean
          reminded_before?: boolean
          status?: string
          value: number
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string
          id?: string
          invoice_url?: string | null
          organization_id?: string
          paid_at?: string | null
          pix_code?: string | null
          provider?: string
          provider_id?: string
          reminded_after?: boolean
          reminded_before?: boolean
          status?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "charges_contact_id_organization_id_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "charges_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      close_reasons: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "close_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profile_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: number
          messages: Json
          organization_id: string
          profile: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: never
          messages?: Json
          organization_id: string
          profile: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: never
          messages?: Json
          organization_id?: string
          profile?: Json
        }
        Relationships: [
          {
            foreignKeyName: "company_profile_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          brand: Json
          last_page: string | null
          organization_id: string
          plan: Json
          plan_at: string | null
          processes: Json
          public_research: Json
          sections: Json
          stage: string
          steps: Json
          suggestions: Json
          suggestions_at: string | null
          updated_at: string
          updated_by: string | null
          use_in_ai: boolean
        }
        Insert: {
          brand?: Json
          last_page?: string | null
          organization_id: string
          plan?: Json
          plan_at?: string | null
          processes?: Json
          public_research?: Json
          sections?: Json
          stage?: string
          steps?: Json
          suggestions?: Json
          suggestions_at?: string | null
          updated_at?: string
          updated_by?: string | null
          use_in_ai?: boolean
        }
        Update: {
          brand?: Json
          last_page?: string | null
          organization_id?: string
          plan?: Json
          plan_at?: string | null
          processes?: Json
          public_research?: Json
          sections?: Json
          stage?: string
          steps?: Json
          suggestions?: Json
          suggestions_at?: string | null
          updated_at?: string
          updated_by?: string | null
          use_in_ai?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_group_members: {
        Row: {
          actor_type: string
          added_by: string | null
          contact_id: string
          created_at: string
          group_id: string
          organization_id: string
        }
        Insert: {
          actor_type?: string
          added_by?: string | null
          contact_id: string
          created_at?: string
          group_id: string
          organization_id: string
        }
        Update: {
          actor_type?: string
          added_by?: string | null
          contact_id?: string
          created_at?: string
          group_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_group_members_contact_id_organization_id_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "contact_group_members_group_id_organization_id_fkey"
            columns: ["group_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contact_groups"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      contact_groups: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string
          sensitive: boolean
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id: string
          sensitive?: boolean
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string
          sensitive?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contact_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_organization_id_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_organization_id_fkey"
            columns: ["tag_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      contacts: {
        Row: {
          anonymized_at: string | null
          created_at: string
          custom: Json
          document: string | null
          email: string | null
          id: string
          name: string | null
          notes: string | null
          opted_out_at: string | null
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          created_at?: string
          custom?: Json
          document?: string | null
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          opted_out_at?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          created_at?: string
          custom?: Json
          document?: string | null
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          opted_out_at?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_enabled: boolean
          assigned_to: string | null
          auto_followup_count: number
          channel: string
          contact_email: string | null
          contact_external_id: string | null
          contact_id: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          department_id: string | null
          email_account_id: string | null
          human_takeover_at: string | null
          id: string
          inactivity_followup_at: string | null
          instance_id: string | null
          last_inbound_at: string | null
          last_message_at: string
          meta_page_id: string | null
          organization_id: string
          stage_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_enabled?: boolean
          assigned_to?: string | null
          auto_followup_count?: number
          channel?: string
          contact_email?: string | null
          contact_external_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          department_id?: string | null
          email_account_id?: string | null
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          instance_id?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          meta_page_id?: string | null
          organization_id: string
          stage_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_enabled?: boolean
          assigned_to?: string | null
          auto_followup_count?: number
          channel?: string
          contact_email?: string | null
          contact_external_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          department_id?: string | null
          email_account_id?: string | null
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          instance_id?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          meta_page_id?: string | null
          organization_id?: string
          stage_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_fk"
            columns: ["organization_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "conversations_contact_fk"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_email_account_fk"
            columns: ["email_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_instance_id_same_org"
            columns: ["instance_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_meta_page_fk"
            columns: ["meta_page_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "meta_pages"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_stage_id_same_org"
            columns: ["stage_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      department_members: {
        Row: {
          created_at: string
          department_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_members_department_id_organization_id_fkey"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "department_members_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      departments: {
        Row: {
          business_hours: Json | null
          color: string | null
          created_at: string
          distribution_mode: string
          id: string
          max_concurrent: number
          name: string
          organization_id: string
          overflow_after_minutes: number | null
          overflow_to: string[]
          preferred_agent: boolean
          preferred_days: number
          queue_alert_minutes: number
          reply_alert_minutes: number
          updated_at: string
        }
        Insert: {
          business_hours?: Json | null
          color?: string | null
          created_at?: string
          distribution_mode?: string
          id?: string
          max_concurrent?: number
          name: string
          organization_id: string
          overflow_after_minutes?: number | null
          overflow_to?: string[]
          preferred_agent?: boolean
          preferred_days?: number
          queue_alert_minutes?: number
          reply_alert_minutes?: number
          updated_at?: string
        }
        Update: {
          business_hours?: Json | null
          color?: string | null
          created_at?: string
          distribution_mode?: string
          id?: string
          max_concurrent?: number
          name?: string
          organization_id?: string
          overflow_after_minutes?: number | null
          overflow_to?: string[]
          preferred_agent?: boolean
          preferred_days?: number
          queue_alert_minutes?: number
          reply_alert_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diag_coverage: {
        Row: {
          complete: number
          items: Json
          organization_id: string
          step_key: string
          total: number
          updated_at: string
        }
        Insert: {
          complete?: number
          items?: Json
          organization_id: string
          step_key: string
          total?: number
          updated_at?: string
        }
        Update: {
          complete?: number
          items?: Json
          organization_id?: string
          step_key?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diag_coverage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diag_delegations: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          raw: string | null
          setor: string
          status: string
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          raw?: string | null
          setor: string
          status?: string
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          raw?: string | null
          setor?: string
          status?: string
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diag_delegations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      diag_findings: {
        Row: {
          ignored: Json
          items: Json
          open_critical: number
          organization_id: string
          reviewer: string
          step_key: string
          updated_at: string
        }
        Insert: {
          ignored?: Json
          items?: Json
          open_critical?: number
          organization_id: string
          reviewer?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          ignored?: Json
          items?: Json
          open_critical?: number
          organization_id?: string
          reviewer?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diag_findings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          address: string
          ai_reply: boolean
          created_at: string
          department_id: string | null
          has_password: boolean
          health_error: string | null
          health_status: string | null
          id: string
          imap_host: string
          imap_port: number
          last_sync_at: string | null
          last_uid: number | null
          name: string
          organization_id: string
          signature: string | null
          smtp_host: string
          smtp_port: number
          status: string
          uidvalidity: number | null
          username: string
        }
        Insert: {
          address: string
          ai_reply?: boolean
          created_at?: string
          department_id?: string | null
          has_password?: boolean
          health_error?: string | null
          health_status?: string | null
          id?: string
          imap_host: string
          imap_port?: number
          last_sync_at?: string | null
          last_uid?: number | null
          name: string
          organization_id: string
          signature?: string | null
          smtp_host: string
          smtp_port?: number
          status?: string
          uidvalidity?: number | null
          username: string
        }
        Update: {
          address?: string
          ai_reply?: boolean
          created_at?: string
          department_id?: string | null
          has_password?: boolean
          health_error?: string | null
          health_status?: string | null
          id?: string
          imap_host?: string
          imap_port?: number
          last_sync_at?: string | null
          last_uid?: number | null
          name?: string
          organization_id?: string
          signature?: string | null
          smtp_host?: string
          smtp_port?: number
          status?: string
          uidvalidity?: number | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_department_id_organization_id_fkey"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "email_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_ignore: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          pattern: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          pattern: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          pattern?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_ignore_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_http_usage: {
        Row: {
          minute: string
          n: number
          organization_id: string
        }
        Insert: {
          minute: string
          n?: number
          organization_id: string
        }
        Update: {
          minute?: string
          n?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_http_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_run_steps: {
        Row: {
          created_at: string
          flow_version_id: string
          id: number
          node_id: string
          organization_id: string
          outcome: string | null
          run_id: string
        }
        Insert: {
          created_at?: string
          flow_version_id: string
          id?: never
          node_id: string
          organization_id: string
          outcome?: string | null
          run_id: string
        }
        Update: {
          created_at?: string
          flow_version_id?: string
          id?: never
          node_id?: string
          organization_id?: string
          outcome?: string | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_run_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "flow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_runs: {
        Row: {
          ai_turns: number
          attempts: number
          conversation_id: string
          current_node_id: string | null
          error: string | null
          finished_at: string | null
          flow_version_id: string
          id: string
          organization_id: string
          started_at: string
          state: string
          ticket_id: string
          updated_at: string
          vars: Json
          wait_until: string | null
        }
        Insert: {
          ai_turns?: number
          attempts?: number
          conversation_id: string
          current_node_id?: string | null
          error?: string | null
          finished_at?: string | null
          flow_version_id: string
          id?: string
          organization_id: string
          started_at?: string
          state?: string
          ticket_id: string
          updated_at?: string
          vars?: Json
          wait_until?: string | null
        }
        Update: {
          ai_turns?: number
          attempts?: number
          conversation_id?: string
          current_node_id?: string | null
          error?: string | null
          finished_at?: string | null
          flow_version_id?: string
          id?: string
          organization_id?: string
          started_at?: string
          state?: string
          ticket_id?: string
          updated_at?: string
          vars?: Json
          wait_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_flow_version_id_fkey"
            columns: ["flow_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_versions: {
        Row: {
          created_at: string
          flow_id: string
          graph: Json
          id: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          flow_id: string
          graph?: Json
          id?: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          status: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          flow_id?: string
          graph?: Json
          id?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "flow_versions_flow_id_organization_id_fkey"
            columns: ["flow_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          kind: string
          organization_id: string
          send_at: string
          sent_at: string | null
          stage_id: string | null
          status: string
          text_override: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind?: string
          organization_id: string
          send_at: string
          sent_at?: string | null
          stage_id?: string | null
          status?: string
          text_override?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind?: string
          organization_id?: string
          send_at?: string
          sent_at?: string | null
          stage_id?: string | null
          status?: string
          text_override?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_conversation_id_same_org"
            columns: ["conversation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "followups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      improvements: {
        Row: {
          agent_key: string | null
          approved_at: string | null
          approved_by: string | null
          area_id: string | null
          artifact_id: string | null
          artifact_kind: string | null
          brain_run_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          discard_reason: string | null
          due_date: string | null
          evidence: Json | null
          goal_id: string | null
          how: string | null
          id: string
          kind: string
          live_at: string | null
          measure_days: number
          metrics_after: Json | null
          metrics_before: Json | null
          modelo: string | null
          organization_id: string
          parent_id: string | null
          priority: number | null
          process_ref: string | null
          reminded_at: string | null
          reminders: number
          result: string | null
          result_note: string | null
          sistema: string | null
          source: string
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          agent_key?: string | null
          approved_at?: string | null
          approved_by?: string | null
          area_id?: string | null
          artifact_id?: string | null
          artifact_kind?: string | null
          brain_run_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          discard_reason?: string | null
          due_date?: string | null
          evidence?: Json | null
          goal_id?: string | null
          how?: string | null
          id?: string
          kind?: string
          live_at?: string | null
          measure_days?: number
          metrics_after?: Json | null
          metrics_before?: Json | null
          modelo?: string | null
          organization_id: string
          parent_id?: string | null
          priority?: number | null
          process_ref?: string | null
          reminded_at?: string | null
          reminders?: number
          result?: string | null
          result_note?: string | null
          sistema?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          agent_key?: string | null
          approved_at?: string | null
          approved_by?: string | null
          area_id?: string | null
          artifact_id?: string | null
          artifact_kind?: string | null
          brain_run_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          discard_reason?: string | null
          due_date?: string | null
          evidence?: Json | null
          goal_id?: string | null
          how?: string | null
          id?: string
          kind?: string
          live_at?: string | null
          measure_days?: number
          metrics_after?: Json | null
          metrics_before?: Json | null
          modelo?: string | null
          organization_id?: string
          parent_id?: string | null
          priority?: number | null
          process_ref?: string | null
          reminded_at?: string | null
          reminders?: number
          result?: string | null
          result_note?: string | null
          sistema?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "improvements_area_fk"
            columns: ["area_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "org_areas"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "improvements_brain_run_fk"
            columns: ["brain_run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brain_runs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "improvements_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "improvements_goal_fk"
            columns: ["goal_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "area_goals"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "improvements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "improvements_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "improvements"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_events: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          instance_id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          provider: string
          provider_message_id: string
          stage: string
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          instance_id: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          provider: string
          provider_message_id: string
          stage?: string
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          instance_id?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_message_id?: string
          stage?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inpi_conflicts: {
        Row: {
          classes: string | null
          created_at: string
          despacho: string | null
          id: string
          marca: string
          numero: string
          prazo: string | null
          reviewed_at: string | null
          rpi: number
          rpi_date: string
          termo: string | null
          titulares: string | null
        }
        Insert: {
          classes?: string | null
          created_at?: string
          despacho?: string | null
          id?: string
          marca: string
          numero: string
          prazo?: string | null
          reviewed_at?: string | null
          rpi: number
          rpi_date: string
          termo?: string | null
          titulares?: string | null
        }
        Update: {
          classes?: string | null
          created_at?: string
          despacho?: string | null
          id?: string
          marca?: string
          numero?: string
          prazo?: string | null
          reviewed_at?: string | null
          rpi?: number
          rpi_date?: string
          termo?: string | null
          titulares?: string | null
        }
        Relationships: []
      }
      inpi_events: {
        Row: {
          codigo: string
          complemento: string | null
          created_at: string
          id: string
          nivel: string
          nome: string
          numero: string
          orientacao: string | null
          prazo: string | null
          rpi: number
          rpi_date: string
        }
        Insert: {
          codigo: string
          complemento?: string | null
          created_at?: string
          id?: string
          nivel?: string
          nome: string
          numero: string
          orientacao?: string | null
          prazo?: string | null
          rpi: number
          rpi_date: string
        }
        Update: {
          codigo?: string
          complemento?: string | null
          created_at?: string
          id?: string
          nivel?: string
          nome?: string
          numero?: string
          orientacao?: string | null
          prazo?: string | null
          rpi?: number
          rpi_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "inpi_events_numero_fkey"
            columns: ["numero"]
            isOneToOne: false
            referencedRelation: "inpi_processes"
            referencedColumns: ["numero"]
          },
        ]
      }
      inpi_processes: {
        Row: {
          created_at: string
          filed_at: string | null
          label: string
          last_at: string | null
          last_rpi: number | null
          last_status: string | null
          marca: string | null
          numero: string
          protocolo: string | null
          source: string
        }
        Insert: {
          created_at?: string
          filed_at?: string | null
          label?: string
          last_at?: string | null
          last_rpi?: number | null
          last_status?: string | null
          marca?: string | null
          numero: string
          protocolo?: string | null
          source?: string
        }
        Update: {
          created_at?: string
          filed_at?: string | null
          label?: string
          last_at?: string | null
          last_rpi?: number | null
          last_status?: string | null
          marca?: string | null
          numero?: string
          protocolo?: string | null
          source?: string
        }
        Relationships: []
      }
      inpi_scans: {
        Row: {
          conflicts: number
          error: string | null
          events: number
          rpi: number
          rpi_date: string | null
          scanned_at: string
        }
        Insert: {
          conflicts?: number
          error?: string | null
          events?: number
          rpi: number
          rpi_date?: string | null
          scanned_at?: string
        }
        Update: {
          conflicts?: number
          error?: string | null
          events?: number
          rpi?: number
          rpi_date?: string | null
          scanned_at?: string
        }
        Relationships: []
      }
      inpi_settings: {
        Row: {
          email_on: boolean
          emails: string[]
          id: boolean
          terms: string[]
          titulares: string[]
          updated_at: string
        }
        Insert: {
          email_on?: boolean
          emails?: string[]
          id?: boolean
          terms?: string[]
          titulares?: string[]
          updated_at?: string
        }
        Update: {
          email_on?: boolean
          emails?: string[]
          id?: boolean
          terms?: string[]
          titulares?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      integration_guides: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          flow_id: string | null
          goal: string
          guide: Json
          id: string
          organization_id: string
          sample: Json | null
          status: string
          system: string
          title: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          flow_id?: string | null
          goal: string
          guide?: Json
          id?: string
          organization_id: string
          sample?: Json | null
          status?: string
          system: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          flow_id?: string | null
          goal?: string
          guide?: Json
          id?: string
          organization_id?: string
          sample?: Json | null
          status?: string
          system?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_guides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notes: {
        Row: {
          author_id: string
          content: string
          conversation_id: string
          created_at: string
          id: string
          mentions: string[]
          organization_id: string
          ticket_id: string | null
        }
        Insert: {
          author_id?: string
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          mentions?: string[]
          organization_id: string
          ticket_id?: string | null
        }
        Update: {
          author_id?: string
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          mentions?: string[]
          organization_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_conversation_id_same_org"
            columns: ["conversation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "internal_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_ticket_id_same_org"
            columns: ["ticket_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      interview_messages: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: number
          organization_id: string
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: never
          organization_id: string
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: never
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          content: string
          doc_id: string
          id: number
          ord: number
          organization_id: string
          tsv: unknown
        }
        Insert: {
          content: string
          doc_id: string
          id?: never
          ord: number
          organization_id: string
          tsv?: unknown
        }
        Update: {
          content?: string
          doc_id?: string
          id?: never
          ord?: number
          organization_id?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_doc_id_organization_id_fkey"
            columns: ["doc_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "knowledge_docs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      knowledge_docs: {
        Row: {
          chunks: number
          created_at: string
          created_by: string | null
          department_id: string | null
          error: string | null
          file_name: string | null
          file_path: string | null
          id: string
          kind: string
          mime: string | null
          organization_id: string
          size: number | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          chunks?: number
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          error?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          kind?: string
          mime?: string | null
          organization_id: string
          size?: number | null
          status?: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          chunks?: number
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          error?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          kind?: string
          mime?: string | null
          organization_id?: string
          size?: number | null
          status?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_docs_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "knowledge_docs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_files: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          media_path: string
          mime: string | null
          name: string
          organization_id: string
          size: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          media_path: string
          mime?: string | null
          name: string
          organization_id: string
          size?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          media_path?: string
          mime?: string | null
          name?: string
          organization_id?: string
          size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "library_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          direction: string
          email_in_reply_to: string | null
          email_message_id: string | null
          email_subject: string | null
          error: string | null
          id: string
          media_mime: string | null
          media_name: string | null
          media_path: string | null
          media_size: number | null
          media_text: string | null
          organization_id: string
          provider_message_id: string | null
          sender: string
          sent_by: string | null
          status: string | null
          ticket_id: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          direction: string
          email_in_reply_to?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          error?: string | null
          id?: string
          media_mime?: string | null
          media_name?: string | null
          media_path?: string | null
          media_size?: number | null
          media_text?: string | null
          organization_id: string
          provider_message_id?: string | null
          sender: string
          sent_by?: string | null
          status?: string | null
          ticket_id?: string | null
          type?: string
          user_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          direction?: string
          email_in_reply_to?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          error?: string | null
          id?: string
          media_mime?: string | null
          media_name?: string | null
          media_path?: string | null
          media_size?: number | null
          media_text?: string | null
          organization_id?: string
          provider_message_id?: string | null
          sender?: string
          sent_by?: string | null
          status?: string | null
          ticket_id?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_same_org"
            columns: ["conversation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_ticket_id_same_org"
            columns: ["ticket_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      meta_connect_sessions: {
        Row: {
          created_at: string
          error: string | null
          expires_at: string
          id: string
          kind: string
          options: Json
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          expires_at?: string
          id?: string
          kind: string
          options?: Json
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          expires_at?: string
          id?: string
          kind?: string
          options?: Json
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_connect_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_pages: {
        Row: {
          ai_reply: boolean
          created_at: string
          department_id: string | null
          id: string
          ig_account_id: string | null
          ig_username: string | null
          instagram: boolean
          last_error: string | null
          messenger: boolean
          name: string
          organization_id: string
          page_id: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_reply?: boolean
          created_at?: string
          department_id?: string | null
          id?: string
          ig_account_id?: string | null
          ig_username?: string | null
          instagram?: boolean
          last_error?: string | null
          messenger?: boolean
          name: string
          organization_id: string
          page_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_reply?: boolean
          created_at?: string
          department_id?: string | null
          id?: string
          ig_account_id?: string | null
          ig_username?: string | null
          instagram?: boolean
          last_error?: string | null
          messenger?: boolean
          name?: string
          organization_id?: string
          page_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_pages_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "meta_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: number
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: never
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: never
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      network_invites: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          hint: string
          id: string
          network_id: string
          used_at: string | null
          used_by_org: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at?: string
          hint: string
          id?: string
          network_id: string
          used_at?: string | null
          used_by_org?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          hint?: string
          id?: string
          network_id?: string
          used_at?: string | null
          used_by_org?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "network_invites_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "networks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "network_invites_used_by_org_fkey"
            columns: ["used_by_org"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      network_standards: {
        Row: {
          created_at: string
          created_by: string | null
          mandatory: boolean
          network_id: string
          payload: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          mandatory?: boolean
          network_id: string
          payload: Json
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          mandatory?: boolean
          network_id?: string
          payload?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "network_standards_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "networks"
            referencedColumns: ["id"]
          },
        ]
      }
      network_units: {
        Row: {
          applied_version: number
          joined_at: string
          network_id: string
          organization_id: string
        }
        Insert: {
          applied_version?: number
          joined_at?: string
          network_id: string
          organization_id: string
        }
        Update: {
          applied_version?: number
          joined_at?: string
          network_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "network_units_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "networks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "network_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      networks: {
        Row: {
          brand: Json
          created_at: string
          hq_org_id: string
          id: string
          name: string
        }
        Insert: {
          brand?: Json
          created_at?: string
          hq_org_id: string
          id?: string
          name: string
        }
        Update: {
          brand?: Json
          created_at?: string
          hq_org_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "networks_hq_org_id_fkey"
            columns: ["hq_org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          emailed_at: string | null
          id: string
          kind: string
          organization_id: string
          read_at: string | null
          ref: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind: string
          organization_id: string
          read_at?: string | null
          ref?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind?: string
          organization_id?: string
          read_at?: string | null
          ref?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          connector: string
          expires_at: string
          organization_id: string
          state: string
          user_id: string
        }
        Insert: {
          connector: string
          expires_at?: string
          organization_id: string
          state: string
          user_id: string
        }
        Update: {
          connector?: string
          expires_at?: string
          organization_id?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_areas: {
        Row: {
          agent_enabled: boolean
          approval_mode: string
          approver_id: string | null
          backup_approver_id: string | null
          created_at: string
          department_id: string | null
          enabled: boolean
          id: string
          key: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          agent_enabled?: boolean
          approval_mode?: string
          approver_id?: string | null
          backup_approver_id?: string | null
          created_at?: string
          department_id?: string | null
          enabled?: boolean
          id?: string
          key: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          agent_enabled?: boolean
          approval_mode?: string
          approver_id?: string | null
          backup_approver_id?: string | null
          created_at?: string
          department_id?: string | null
          enabled?: boolean
          id?: string
          key?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_areas_approver_fk"
            columns: ["organization_id", "approver_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "org_areas_backup_fk"
            columns: ["organization_id", "backup_approver_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "org_areas_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "org_areas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_connections: {
        Row: {
          connected_at: string
          connected_by: string | null
          connector: string
          error: string | null
          organization_id: string
          status: string
          token_expires_at: string | null
        }
        Insert: {
          connected_at?: string
          connected_by?: string | null
          connector: string
          error?: string | null
          organization_id: string
          status?: string
          token_expires_at?: string | null
        }
        Update: {
          connected_at?: string
          connected_by?: string | null
          connector?: string
          error?: string | null
          organization_id?: string
          status?: string
          token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_modules: {
        Row: {
          enabled: boolean
          limits: Json
          module: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          limits?: Json
          module: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          limits?: Json
          module?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_rate_usage: {
        Row: {
          bucket: string
          minute: string
          n: number
          organization_id: string
        }
        Insert: {
          bucket: string
          minute: string
          n?: number
          organization_id: string
        }
        Update: {
          bucket?: string
          minute?: string
          n?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_rate_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_secrets: {
        Row: {
          name: string
          organization_id: string
          secret_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          name: string
          organization_id: string
          secret_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          name?: string
          organization_id?: string
          secret_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_templates: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          key: string
          name: string
          payload: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          key: string
          name: string
          payload: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          key?: string
          name?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          display_name: string | null
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          plan: string | null
          settings: Json
          slug: string
          status: string
          template_key: string | null
          ticket_seq: number
          ticket_year: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          plan?: string | null
          settings?: Json
          slug: string
          status?: string
          template_key?: string | null
          ticket_seq?: number
          ticket_year?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          plan?: string | null
          settings?: Json
          slug?: string
          status?: string
          template_key?: string | null
          ticket_seq?: number
          ticket_year?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      pause_reasons: {
        Row: {
          active: boolean
          id: string
          name: string
          organization_id: string
          position: number
        }
        Insert: {
          active?: boolean
          id?: string
          name: string
          organization_id: string
          position?: number
        }
        Update: {
          active?: boolean
          id?: string
          name?: string
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pause_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pbx_extensions: {
        Row: {
          created_at: string
          has_password: boolean
          id: string
          label: string | null
          mode: string
          number: string
          organization_id: string
          provider: string
          reg_at: string | null
          reg_detail: string | null
          reg_state: string | null
          sip_domain: string
          sip_user: string
          updated_at: string
          user_id: string | null
          wss_url: string | null
        }
        Insert: {
          created_at?: string
          has_password?: boolean
          id?: string
          label?: string | null
          mode?: string
          number: string
          organization_id: string
          provider?: string
          reg_at?: string | null
          reg_detail?: string | null
          reg_state?: string | null
          sip_domain: string
          sip_user: string
          updated_at?: string
          user_id?: string | null
          wss_url?: string | null
        }
        Update: {
          created_at?: string
          has_password?: boolean
          id?: string
          label?: string | null
          mode?: string
          number?: string
          organization_id?: string
          provider?: string
          reg_at?: string | null
          reg_detail?: string | null
          reg_state?: string | null
          sip_domain?: string
          sip_user?: string
          updated_at?: string
          user_id?: string | null
          wss_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pbx_extensions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          followup_days: number[]
          followup_hint: string | null
          followup_template: string | null
          followup_template_lang: string
          id: string
          name: string
          organization_id: string
          position: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          followup_days?: number[]
          followup_hint?: string | null
          followup_template?: string | null
          followup_template_lang?: string
          id?: string
          name: string
          organization_id: string
          position?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          followup_days?: number[]
          followup_hint?: string | null
          followup_template?: string | null
          followup_template_lang?: string
          id?: string
          name?: string
          organization_id?: string
          position?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          description: string | null
          features: string[]
          key: string
          limits: Json
          modules: string[]
          name: string
          price_cents: number
          public: boolean
          setup_cents: number
          sort: number
          trial_days: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          description?: string | null
          features?: string[]
          key: string
          limits?: Json
          modules?: string[]
          name: string
          price_cents?: number
          public?: boolean
          setup_cents?: number
          sort?: number
          trial_days?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          description?: string | null
          features?: string[]
          key?: string
          limits?: Json
          modules?: string[]
          name?: string
          price_cents?: number
          public?: boolean
          setup_cents?: number
          sort?: number
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_ai_slots: {
        Row: {
          last_alert_at: string | null
          last_error: string | null
          last_error_at: string | null
          last_ok_at: string | null
          model: string | null
          provider: string
          slot: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          last_alert_at?: string | null
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          model?: string | null
          provider: string
          slot: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          last_alert_at?: string | null
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          model?: string | null
          provider?: string
          slot?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_company: {
        Row: {
          cnpj: string
          extra: Json
          id: boolean
          official: Json
          refresh_error: string | null
          refreshed_at: string | null
          updated_at: string
        }
        Insert: {
          cnpj: string
          extra?: Json
          id?: boolean
          official?: Json
          refresh_error?: string | null
          refreshed_at?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string
          extra?: Json
          id?: boolean
          official?: Json
          refresh_error?: string | null
          refreshed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_operators: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      process_designs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          architect_note: string | null
          department_id: string | null
          design: Json
          id: string
          nome: string
          organization_id: string
          proposed_at: string
          setor: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          architect_note?: string | null
          department_id?: string | null
          design?: Json
          id?: string
          nome: string
          organization_id: string
          proposed_at?: string
          setor: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          architect_note?: string | null
          department_id?: string | null
          design?: Json
          id?: string
          nome?: string
          organization_id?: string
          proposed_at?: string
          setor?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "process_designs_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "process_designs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          department_id: string | null
          id: string
          library_file_id: string | null
          organization_id: string
          shortcut: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          library_file_id?: string | null
          organization_id: string
          shortcut: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          library_file_id?: string | null
          organization_id?: string
          shortcut?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_department_id_organization_id_fkey"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quick_replies_library_file_fk"
            columns: ["library_file_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "library_files"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "quick_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      record_types: {
        Row: {
          access: string
          created_at: string
          created_by: string | null
          description: string | null
          fields: Json
          id: string
          key: string
          link_contact: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          access?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          key: string
          link_contact?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          access?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          key?: string
          link_contact?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      records: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          data: Json
          id: string
          organization_id: string
          title: string | null
          type_id: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          organization_id: string
          title?: string | null
          type_id: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          organization_id?: string
          title?: string | null
          type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "records_contact_id_organization_id_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "records_type_id_organization_id_fkey"
            columns: ["type_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "record_types"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      report_emails: {
        Row: {
          created_at: string
          frequency: string
          kinds: string[]
          last_sent_at: string | null
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          frequency: string
          kinds: string[]
          last_sent_at?: string | null
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          frequency?: string
          kinds?: string[]
          last_sent_at?: string | null
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          created_at: string
          created_by: string | null
          guide_id: string | null
          id: string
          message: string
          organization_id: string
          page: string | null
          protocol: string | null
          reply: string | null
          source: string
          status: string
          topic: string
          transcript: Json | null
          updated_at: string
          urgency: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guide_id?: string | null
          id?: string
          message: string
          organization_id: string
          page?: string | null
          protocol?: string | null
          reply?: string | null
          source?: string
          status?: string
          topic: string
          transcript?: Json | null
          updated_at?: string
          urgency?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guide_id?: string | null
          id?: string
          message?: string
          organization_id?: string
          page?: string | null
          protocol?: string | null
          reply?: string | null
          source?: string
          status?: string
          topic?: string
          transcript?: Json | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_guide_id_organization_id_fkey"
            columns: ["guide_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "integration_guides"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "service_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          billing_email: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          organization_id: string
          plan_key: string
          reminded_at: string | null
          setup_payment_id: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          billing_email?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          organization_id: string
          plan_key: string
          reminded_at?: string | null
          setup_payment_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          billing_email?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          organization_id?: string
          plan_key?: string
          reminded_at?: string | null
          setup_payment_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      support_access: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          operator_id: string
          organization_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          operator_id: string
          organization_id: string
          reason: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          operator_id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "platform_operators"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_departments: {
        Row: {
          department_id: string
          organization_id: string
          tag_id: string
        }
        Insert: {
          department_id: string
          organization_id: string
          tag_id: string
        }
        Update: {
          department_id?: string
          organization_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_departments_department_id_organization_id_fkey"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tag_departments_tag_id_organization_id_fkey"
            columns: ["tag_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          icon: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_channel_members: {
        Row: {
          channel_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_channel_members_channel_id_organization_id_fkey"
            columns: ["channel_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "team_channels"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      team_channels: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          dm_key: string | null
          id: string
          kind: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          dm_key?: string | null
          id?: string
          kind: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          dm_key?: string | null
          id?: string
          kind?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_channels_department_fk"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "team_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          organization_id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "team_members_team_id_organization_id_fkey"
            columns: ["team_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      team_messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          author_id: string
          channel_id: string
          content: string | null
          conversation_id: string | null
          created_at: string
          id: number
          mentions: string[]
          organization_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          author_id: string
          channel_id: string
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: never
          mentions?: string[]
          organization_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          author_id?: string
          channel_id?: string
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: never
          mentions?: string[]
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_channel_id_organization_id_fkey"
            columns: ["channel_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "team_channels"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "team_messages_conversation_fk"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_conversation_id_same_org"
            columns: ["conversation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      team_reactions: {
        Row: {
          channel_id: string
          created_at: string
          emoji: string
          message_id: number
          organization_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          emoji: string
          message_id: number
          organization_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          emoji?: string
          message_id?: number
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_reactions_channel_id_organization_id_fkey"
            columns: ["channel_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "team_channels"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "team_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      team_reads: {
        Row: {
          channel_id: string
          last_read_id: number
          organization_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          last_read_id?: number
          organization_id: string
          user_id?: string
        }
        Update: {
          channel_id?: string
          last_read_id?: number
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_reads_channel_id_organization_id_fkey"
            columns: ["channel_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "team_channels"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          department_id: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_department_id_organization_id_fkey"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: number
          meta: Json
          organization_id: string
          ticket_id: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: never
          meta?: Json
          organization_id: string
          ticket_id: string
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: never
          meta?: Json
          organization_id?: string
          ticket_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_reviews: {
        Row: {
          agent_feedback: string | null
          agent_id: string | null
          attempts: number
          created_at: string
          department_id: string | null
          error: string | null
          id: string
          model: string | null
          organization_id: string
          process_issues: Json
          reason: string | null
          reviewed_at: string | null
          satisfied: string | null
          score: number | null
          status: string
          ticket_id: string
        }
        Insert: {
          agent_feedback?: string | null
          agent_id?: string | null
          attempts?: number
          created_at?: string
          department_id?: string | null
          error?: string | null
          id?: string
          model?: string | null
          organization_id: string
          process_issues?: Json
          reason?: string | null
          reviewed_at?: string | null
          satisfied?: string | null
          score?: number | null
          status?: string
          ticket_id: string
        }
        Update: {
          agent_feedback?: string | null
          agent_id?: string | null
          attempts?: number
          created_at?: string
          department_id?: string | null
          error?: string | null
          id?: string
          model?: string | null
          organization_id?: string
          process_issues?: Json
          reason?: string | null
          reviewed_at?: string | null
          satisfied?: string | null
          score?: number | null
          status?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_reviews_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          close_note?: string | null
          close_reason_id?: string | null
          closed_at?: string | null
          conversation_id: string
          created_at?: string
          department_id?: string | null
          external_reply?: boolean
          first_response_at?: string | null
          id?: string
          opened_at?: string | null
          organization_id: string
          overflow_at?: string | null
          protocol: string
          queued_at?: string | null
          rating?: number | null
          rating_comment?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          close_note?: string | null
          close_reason_id?: string | null
          closed_at?: string | null
          conversation_id?: string
          created_at?: string
          department_id?: string | null
          external_reply?: boolean
          first_response_at?: string | null
          id?: string
          opened_at?: string | null
          organization_id?: string
          overflow_at?: string | null
          protocol?: string
          queued_at?: string | null
          rating?: number | null
          rating_comment?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_close_reason_id_organization_id_fkey"
            columns: ["close_reason_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "close_reasons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_department_id_organization_id_fkey"
            columns: ["department_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tickets_organization_id_assigned_to_fkey"
            columns: ["organization_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_integrations: {
        Row: {
          created_at: string
          enabled: boolean
          has_credentials: boolean
          last_error: string | null
          last_sync_at: string | null
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          has_credentials?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          organization_id: string
          provider?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          has_credentials?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          endpoint_id: string
          error: string | null
          event: string
          id: number
          next_at: string
          organization_id: string
          payload: Json
          response_code: number | null
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          endpoint_id: string
          error?: string | null
          event: string
          id?: never
          next_at?: string
          organization_id: string
          payload: Json
          response_code?: number | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          endpoint_id?: string
          error?: string | null
          event?: string
          id?: never
          next_at?: string
          organization_id?: string
          payload?: Json
          response_code?: number | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_fk"
            columns: ["endpoint_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          active: boolean
          created_at: string
          events: string[]
          failures: number
          id: string
          last_at: string | null
          last_status: number | null
          organization_id: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          events: string[]
          failures?: number
          id?: string
          last_at?: string | null
          last_status?: number | null
          organization_id: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          events?: string[]
          failures?: number
          id?: string
          last_at?: string | null
          last_status?: number | null
          organization_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          color: string | null
          connected_via: string | null
          created_at: string
          flow_id: string | null
          health_error: string | null
          health_status: string | null
          id: string
          instance_token: string | null
          last_disconnected_at: string | null
          last_health_check_at: string | null
          messaging_limit_tier: string | null
          name: string
          organization_id: string
          phone: string | null
          phone_number_id: string | null
          profile_name: string | null
          provider: string
          quality_rating: string | null
          secret_name: string | null
          server_url: string | null
          status: string
          token_hash: string | null
          updated_at: string
          user_id: string | null
          waba_id: string | null
        }
        Insert: {
          color?: string | null
          connected_via?: string | null
          created_at?: string
          flow_id?: string | null
          health_error?: string | null
          health_status?: string | null
          id?: string
          instance_token?: string | null
          last_disconnected_at?: string | null
          last_health_check_at?: string | null
          messaging_limit_tier?: string | null
          name: string
          organization_id: string
          phone?: string | null
          phone_number_id?: string | null
          profile_name?: string | null
          provider?: string
          quality_rating?: string | null
          secret_name?: string | null
          server_url?: string | null
          status?: string
          token_hash?: string | null
          updated_at?: string
          user_id?: string | null
          waba_id?: string | null
        }
        Update: {
          color?: string | null
          connected_via?: string | null
          created_at?: string
          flow_id?: string | null
          health_error?: string | null
          health_status?: string | null
          id?: string
          instance_token?: string | null
          last_disconnected_at?: string | null
          last_health_check_at?: string | null
          messaging_limit_tier?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          phone_number_id?: string | null
          profile_name?: string | null
          provider?: string
          quality_rating?: string | null
          secret_name?: string | null
          server_url?: string | null
          status?: string
          token_hash?: string | null
          updated_at?: string
          user_id?: string | null
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_flow_fk"
            columns: ["flow_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "whatsapp_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { org: string }; Returns: boolean }
      add_default_tags: { Args: { org: string }; Returns: number }
      ai_keys_status: { Args: { org: string }; Returns: Json }
      approve_improvement: { Args: { improvement: string }; Returns: undefined }
      approve_process_design: { Args: { p_id: string }; Returns: undefined }
      archive_process_design: { Args: { p_id: string }; Returns: undefined }
      area_activity: {
        Args: { area: string; org: string; since: string }
        Returns: Json
      }
      assign_extension: {
        Args: { ext: string; member: string }
        Returns: undefined
      }
      brain_overview: { Args: { org: string }; Returns: Json }
      brain_pending: { Args: { org: string }; Returns: Json }
      brand_kit: { Args: { org: string }; Returns: Json }
      campaign_audience: {
        Args: { groups: string[]; org: string }
        Returns: Json
      }
      campaign_results: { Args: { campaign: string }; Returns: Json }
      can_design_process: {
        Args: { org: string; p_setor: string }
        Returns: boolean
      }
      can_manage_knowledge: {
        Args: { dept: string; org: string }
        Returns: boolean
      }
      claim_inbound_events: {
        Args: { max_rows?: number }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          instance_id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          provider: string
          provider_message_id: string
          stage: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "inbound_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_ticket: {
        Args: { ticket: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_opt_out: { Args: { contact: string }; Returns: undefined }
      close_improvement_now: {
        Args: { improvement: string }
        Returns: undefined
      }
      close_ticket: {
        Args: { note?: string; reason: string; ticket: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      company_profile_snapshots_count: {
        Args: { org: string }
        Returns: number
      }
      connector_apps_status: { Args: never; Returns: Json }
      create_api_key: {
        Args: { org: string; p_name: string; p_scopes: string[] }
        Returns: Json
      }
      create_improvement: {
        Args: {
          department: string
          description: string
          how: string
          kind: string
          org: string
          title: string
        }
        Returns: string
      }
      delete_extension: { Args: { ext: string }; Returns: undefined }
      delete_http_secret: {
        Args: { org: string; secret_key: string }
        Returns: undefined
      }
      delete_webhook_endpoint: {
        Args: { endpoint: string }
        Returns: undefined
      }
      diag_close_delegation: {
        Args: { delegation: string; p_used: boolean }
        Returns: undefined
      }
      diag_invite_sector: {
        Args: { org: string; p_setor: string; uid: string }
        Returns: string
      }
      diag_submit_sector: {
        Args: { delegation: string; p_raw: string }
        Returns: undefined
      }
      discard_improvement: {
        Args: { improvement: string; reason: string }
        Returns: undefined
      }
      ensure_team_channels: { Args: { org: string }; Returns: undefined }
      export_contacts: { Args: { org: string }; Returns: Json }
      flow_stats: {
        Args: { flow: string; period?: number }
        Returns: {
          n: number
          node_id: string
          outcome: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat: { Args: { org: string }; Returns: undefined }
      ignore_email_sender: {
        Args: { conv: string; whole_domain?: boolean }
        Returns: string
      }
      implantation_compare: { Args: { org: string }; Returns: Json }
      leave_team_group: { Args: { ch: string }; Returns: undefined }
      link_improvement_artifact: {
        Args: { aid: string; akind: string; improvement: string }
        Returns: undefined
      }
      link_improvement_process: {
        Args: { improvement: string; process_name: string }
        Returns: undefined
      }
      list_http_secrets: {
        Args: { org: string }
        Returns: {
          name: string
          updated_at: string
        }[]
      }
      log_call: {
        Args: {
          call: string
          org: string
          p_answered_at?: string
          p_direction: string
          p_ended_at?: string
          p_phone: string
          p_source: string
          p_status: string
        }
        Returns: string
      }
      log_report_export: {
        Args: { kind: string; org: string }
        Returns: undefined
      }
      lookup_caller: {
        Args: { org: string; p_phone: string }
        Returns: {
          channel: string
          contact_id: string
          conversation_id: string
          name: string
          phone: string
        }[]
      }
      merge_groups: {
        Args: { source: string; target: string }
        Returns: number
      }
      merge_tags: { Args: { source: string; target: string }; Returns: number }
      my_extension: { Args: { org: string }; Returns: Json }
      my_invitations: {
        Args: never
        Returns: {
          organization_id: string
          organization_name: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      my_mfa_status: { Args: never; Returns: Json }
      my_network: { Args: { org: string }; Returns: Json }
      my_permissions: { Args: { org: string }; Returns: string[] }
      my_recovery_codes_left: { Args: never; Returns: number }
      my_subscription: { Args: { org: string }; Returns: Json }
      my_support_access: {
        Args: never
        Returns: {
          expires_at: string
          name: string
          organization_id: string
        }[]
      }
      network_apply_standard: { Args: { org: string }; Returns: number }
      network_dashboard: {
        Args: { net: string; since: string; until: string }
        Returns: Json
      }
      network_invite: { Args: { net: string }; Returns: string }
      network_join: { Args: { org: string; p_code: string }; Returns: string }
      network_leave: { Args: { org: string }; Returns: undefined }
      network_publish_standard: {
        Args: { net: string; p_mandatory: boolean }
        Returns: number
      }
      network_remove_unit: {
        Args: { net: string; unit: string }
        Returns: undefined
      }
      nudge_improvement: { Args: { improvement: string }; Returns: undefined }
      number_activity: {
        Args: { org: string }
        Returns: {
          instance_id: string
          last_inbound_at: string
        }[]
      }
      open_direct_chat: {
        Args: { org: string; other: string }
        Returns: string
      }
      operator_delete_extension: { Args: { ext: string }; Returns: undefined }
      operator_org_members: {
        Args: { org: string }
        Returns: {
          email: string
          name: string
          role: string
          user_id: string
        }[]
      }
      operator_save_extension: {
        Args: {
          ext: string
          org: string
          p_label: string
          p_number: string
          p_password: string
          p_provider: string
          p_sip_domain: string
          p_sip_user: string
          p_wss_url: string
        }
        Returns: string
      }
      org_access_state: { Args: { org: string }; Returns: Json }
      org_health: { Args: { org: string }; Returns: Json }
      org_setup_status: { Args: { org: string }; Returns: Json }
      org_theme: { Args: { org: string }; Returns: Json }
      platform_ai_available: { Args: { org: string }; Returns: boolean }
      platform_ai_clear: { Args: { slot_name: string }; Returns: undefined }
      platform_ai_set: {
        Args: {
          model_name: string
          provider_name: string
          secret_value: string
          slot_name: string
        }
        Returns: undefined
      }
      platform_ai_status: { Args: never; Returns: Json }
      platform_ai_usage: {
        Args: { since: string }
        Returns: {
          audio_calls: number
          calls: number
          organization_id: string
          organization_name: string
          provider: string
          source: string
          tokens_in: number
          tokens_out: number
        }[]
      }
      platform_billing_status: { Args: never; Returns: Json }
      platform_brain_usage: { Args: { since: string }; Returns: Json }
      platform_close_support: { Args: { org: string }; Returns: undefined }
      platform_create_network: {
        Args: { hq: string; p_name: string }
        Returns: string
      }
      platform_inpi_remove_process: {
        Args: { p_numero: string }
        Returns: undefined
      }
      platform_inpi_review_conflict: {
        Args: { p_id: string }
        Returns: undefined
      }
      platform_inpi_save_process: {
        Args: {
          p_filed_at: string
          p_label: string
          p_numero: string
          p_protocolo: string
        }
        Returns: undefined
      }
      platform_inpi_set_email: {
        Args: { p_emails: string[]; p_on: boolean }
        Returns: undefined
      }
      platform_inpi_set_watch: {
        Args: { p_terms: string[]; p_titulares: string[] }
        Returns: undefined
      }
      platform_meta_app: { Args: never; Returns: Json }
      platform_networks: { Args: never; Returns: Json }
      platform_open_support: {
        Args: { minutes?: number; org: string; reason: string }
        Returns: string
      }
      platform_org_overview: {
        Args: never
        Returns: {
          conversations_30d: number
          created_at: string
          id: string
          last_activity: string
          mailboxes: number
          members: number
          name: string
          numbers: number
          plan: string
          status: string
          support_until: string
          template_key: string
        }[]
      }
      platform_save_plan: {
        Args: {
          p_active: boolean
          p_description: string
          p_features: string[]
          p_key: string
          p_limits: Json
          p_modules: string[]
          p_name: string
          p_price: number
          p_public: boolean
          p_setup: number
          p_sort: number
          p_trial: number
        }
        Returns: undefined
      }
      platform_secret_status: { Args: never; Returns: Json }
      platform_security_email: { Args: never; Returns: string }
      platform_set_company_extra: {
        Args: { p_extra: Json }
        Returns: undefined
      }
      platform_set_connector_app: {
        Args: { client_id: string; client_secret: string; connector: string }
        Returns: undefined
      }
      platform_set_meta_app: {
        Args: {
          p_app_id: string
          p_config_pages: string
          p_config_whatsapp: string
        }
        Returns: undefined
      }
      platform_set_module: {
        Args: { m: string; on_off: boolean; org: string }
        Returns: undefined
      }
      platform_set_module_limits: {
        Args: { lim: Json; m: string; org: string }
        Returns: undefined
      }
      platform_set_network_brand: {
        Args: { net: string; p_brand: Json }
        Returns: undefined
      }
      platform_set_org_status: {
        Args: { new_status: string; org: string }
        Returns: undefined
      }
      platform_set_request_status: {
        Args: { new_status: string; p_reply?: string; request: string }
        Returns: undefined
      }
      platform_set_security_email: {
        Args: { email: string }
        Returns: undefined
      }
      platform_set_subscription: {
        Args: {
          new_status: string
          org: string
          plan: string
          trial_days: number
        }
        Returns: undefined
      }
      publish_flow: { Args: { flow: string }; Returns: number }
      report: {
        Args: {
          dept?: string
          kind: string
          org: string
          since: string
          until: string
        }
        Returns: Json
      }
      report_extension_status: {
        Args: { ext: string; p_detail?: string; p_state: string }
        Returns: undefined
      }
      reset_company_profile: { Args: { org: string }; Returns: Json }
      restore_company_profile: { Args: { org: string }; Returns: Json }
      return_ticket_to_ai: {
        Args: { ticket: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_api_key: { Args: { key_id: string }; Returns: undefined }
      sales_funnel_report: {
        Args: { org: string; since: string }
        Returns: Json
      }
      save_area_goal: {
        Args: {
          area: string
          goal: string
          org: string
          p_direction: string
          p_ends: string
          p_metric: string
          p_period: string
          p_target: number
          p_title: string
        }
        Returns: string
      }
      save_extension: {
        Args: {
          ext: string
          org: string
          p_label: string
          p_number: string
          p_password: string
          p_provider: string
          p_sip_domain: string
          p_sip_user: string
          p_wss_url: string
        }
        Returns: string
      }
      save_step_draft: {
        Args: { org: string; p_attachments: Json; p_key: string; p_raw: string }
        Returns: undefined
      }
      save_step_review: {
        Args: { org: string; p_key: string; p_review: Json }
        Returns: undefined
      }
      save_team_group: {
        Args: { ch: string; org: string; p_members: string[]; p_name: string }
        Returns: string
      }
      save_voice_progress: {
        Args: { org: string; p_key: string; p_qa: Json }
        Returns: undefined
      }
      save_webhook_endpoint: {
        Args: {
          endpoint: string
          org: string
          p_active: boolean
          p_events: string[]
          p_url: string
        }
        Returns: Json
      }
      search_messages: {
        Args: { org: string; q: string }
        Returns: {
          conversation_id: string
        }[]
      }
      seed_org_areas: { Args: { org: string }; Returns: number }
      seed_pipeline_stages: { Args: { _user_id: string }; Returns: undefined }
      self_signup_org: {
        Args: { org_name: string; plan: string; template: string }
        Returns: string
      }
      service_add_improvements: {
        Args: {
          items: Json
          org: string
          replace_suggested?: boolean
          src: string
        }
        Returns: number
      }
      service_ai_failover_alert: {
        Args: { slot_name: string }
        Returns: boolean
      }
      service_ai_slot_error: {
        Args: { err: string; slot_name: string }
        Returns: undefined
      }
      service_ai_slot_ok: { Args: { slot_name: string }; Returns: undefined }
      service_ai_take: { Args: { org: string }; Returns: boolean }
      service_ai_usage_add: {
        Args: {
          n_audio: number
          n_calls: number
          n_in: number
          n_out: number
          org: string
          provider_name: string
          source_name: string
        }
        Returns: undefined
      }
      service_anonymize_contact: {
        Args: { actor: string; contact: string; org: string; reason: string }
        Returns: Json
      }
      service_api_key_lookup: { Args: { hash: string }; Returns: Json }
      service_api_take: { Args: { org: string }; Returns: boolean }
      service_billing_cancel: { Args: { org: string }; Returns: undefined }
      service_billing_event: {
        Args: { due: string; ev: string; event_id: string; sub: string }
        Returns: string
      }
      service_billing_link: {
        Args: {
          customer: string
          email: string
          org: string
          plan: string
          setup_id: string
          sub: string
        }
        Returns: undefined
      }
      service_brain_can_run_manual: { Args: { org: string }; Returns: string }
      service_brain_due: { Args: never; Returns: string[] }
      service_brain_finish_run: {
        Args: {
          org: string
          p_calls: number
          p_error: string
          p_hash: string
          p_in: number
          p_model: string
          p_out: number
          p_status: string
          p_summary: Json
          run: string
        }
        Returns: undefined
      }
      service_brain_last_hash: { Args: { org: string }; Returns: string }
      service_brain_packet: { Args: { org: string }; Returns: Json }
      service_brain_propose_area: {
        Args: { area: string; items: Json; org: string; run: string }
        Returns: number
      }
      service_brain_start_run: {
        Args: { org: string; p_kind: string; who: string }
        Returns: string
      }
      service_can_add_number: { Args: { org: string }; Returns: boolean }
      service_create_org: {
        Args: { creator: string; org_name: string; template: string }
        Returns: string
      }
      service_delete_instance_secrets: {
        Args: { instance: string }
        Returns: undefined
      }
      service_diag_coverage_save: {
        Args: { org: string; p_items: Json; p_key: string }
        Returns: Json
      }
      service_diag_findings_save: {
        Args: { org: string; p_items: Json; p_key: string; p_reviewer: string }
        Returns: Json
      }
      service_get_secret: { Args: { secret_name: string }; Returns: string }
      service_has_secret: { Args: { secret_name: string }; Returns: boolean }
      service_http_take: { Args: { org: string }; Returns: boolean }
      service_inpi_recipients: { Args: never; Returns: Json }
      service_inpi_record: {
        Args: {
          p_conflicts: Json
          p_date: string
          p_error: string
          p_processes: Json
          p_rpi: number
        }
        Returns: Json
      }
      service_inpi_watch: { Args: never; Returns: Json }
      service_install_sales_funnel: { Args: { org: string }; Returns: Json }
      service_mark_message_deleted: {
        Args: { org: string; pmid: string; who: string }
        Returns: number
      }
      service_meta_connect_forget: {
        Args: { sess: string }
        Returns: undefined
      }
      service_meta_page_forget: { Args: { page: string }; Returns: undefined }
      service_module_on: { Args: { m: string; org: string }; Returns: boolean }
      service_platform_alert_recipients: { Args: never; Returns: string[] }
      service_process_design_save: {
        Args: { org: string; p_design: Json; p_nome: string; p_setor: string }
        Returns: string
      }
      service_put_secret: {
        Args: { secret_name: string; secret_value: string }
        Returns: undefined
      }
      service_report_as: {
        Args: {
          kind: string
          org: string
          since: string
          uid: string
          until: string
        }
        Returns: Json
      }
      service_report_emails_due: {
        Args: never
        Returns: {
          email: string
          frequency: string
          kinds: string[]
          org_name: string
          organization_id: string
          user_id: string
        }[]
      }
      service_search_knowledge: {
        Args: {
          depts?: string[]
          lim?: number
          org: string
          q: string
          scope: string
        }
        Returns: {
          content: string
          kind: string
          rank: number
          title: string
        }[]
      }
      service_ticket_for_inbound: {
        Args: { conv: string; from_me: boolean }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      service_ticket_route: {
        Args: {
          action: string
          dept?: string
          reason?: string
          ticket: string
          to_user?: string
        }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      service_update_message_status: {
        Args: { new_status: string; org: string; pmid: string }
        Returns: undefined
      }
      service_upsert_call: {
        Args: {
          org: string
          p_answered_at: string
          p_direction: string
          p_duration: number
          p_ended_at: string
          p_ext_number: string
          p_phone: string
          p_provider_call_id: string
          p_recording_url: string
          p_started_at: string
          p_status: string
          p_user?: string
        }
        Returns: string
      }
      service_webhook_claim: {
        Args: { lim: number }
        Returns: {
          attempts: number
          endpoint_id: string
          event: string
          id: number
          organization_id: string
          payload: Json
          url: string
        }[]
      }
      service_webhook_result: {
        Args: { code: number; delivery: number; err: string; ok: boolean }
        Returns: undefined
      }
      set_area_goal_status: {
        Args: { goal: string; new_status: string }
        Returns: undefined
      }
      set_auto_review: {
        Args: { enabled: boolean; org: string }
        Returns: undefined
      }
      set_campaign_status: {
        Args: { campaign: string; new_status: string }
        Returns: undefined
      }
      set_coverage_item: {
        Args: { org: string; p_key: string; p_n: number; p_nao_tem: boolean }
        Returns: Json
      }
      set_email_password: {
        Args: { account: string; secret_value: string }
        Returns: undefined
      }
      set_extension_mode: {
        Args: { ext: string; p_mode: string }
        Returns: undefined
      }
      set_finding_status: {
        Args: { org: string; p_key: string; p_n: number; p_status: string }
        Returns: Json
      }
      set_http_secret: {
        Args: { org: string; secret_key: string; secret_value: string }
        Returns: undefined
      }
      set_improvement_area: {
        Args: { area: string; improvement: string }
        Returns: undefined
      }
      set_improvement_due: {
        Args: { due: string; improvement: string }
        Returns: undefined
      }
      set_improvement_live: {
        Args: { days?: number; improvement: string }
        Returns: undefined
      }
      set_instance_secret: {
        Args: { instance: string; secret_value: string }
        Returns: undefined
      }
      set_member_name: {
        Args: { member: string; name: string; org: string }
        Returns: undefined
      }
      set_meta_page: {
        Args: {
          p_ai_reply: boolean
          p_department: string
          p_instagram: boolean
          p_messenger: boolean
          page: string
        }
        Returns: undefined
      }
      set_org_area: {
        Args: {
          agent_on: boolean
          approver: string
          area: string
          backup: string
          department: string
          mode: string
          on_off: boolean
          org: string
          p_key: string
          p_name: string
        }
        Returns: string
      }
      set_org_secret: {
        Args: { org: string; secret_key: string; secret_value: string }
        Returns: undefined
      }
      set_platform_secret: {
        Args: { secret_key: string; secret_value: string }
        Returns: undefined
      }
      set_presence: {
        Args: { new_status: string; org: string; reason?: string }
        Returns: undefined
      }
      set_process_design_note: {
        Args: { p_id: string; p_note: string }
        Returns: undefined
      }
      set_report_email: {
        Args: { freq: string; org: string; p_kinds: string[] }
        Returns: undefined
      }
      set_require_mfa: {
        Args: { org: string; required: boolean }
        Returns: undefined
      }
      set_voice_integration: {
        Args: {
          org: string
          p_client_id: string
          p_client_secret: string
          p_enabled?: boolean
        }
        Returns: undefined
      }
      signup_templates: { Args: never; Returns: Json }
      start_campaign: { Args: { campaign: string }; Returns: Json }
      start_implantation: { Args: { org: string }; Returns: Json }
      supervisor_dashboard: { Args: { org: string }; Returns: Json }
      tag_group_counts: { Args: { org: string }; Returns: Json }
      take_over_ticket: {
        Args: { ticket: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      team_react: { Args: { msg: number; p_emoji: string }; Returns: boolean }
      team_unread: {
        Args: { org: string }
        Returns: {
          channel_id: string
          unread: number
        }[]
      }
      test_webhook_endpoint: { Args: { endpoint: string }; Returns: undefined }
      transfer_ticket: {
        Args: {
          note?: string
          ticket: string
          to_department?: string
          to_user?: string
        }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          close_note: string | null
          close_reason_id: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          department_id: string | null
          external_reply: boolean
          first_response_at: string | null
          id: string
          opened_at: string | null
          organization_id: string
          overflow_at: string | null
          protocol: string
          queued_at: string | null
          rating: number | null
          rating_comment: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unignore_email: {
        Args: { org: string; p_pattern: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      org_role: "owner" | "admin" | "supervisor" | "agent"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      org_role: ["owner", "admin", "supervisor", "agent"],
    },
  },
} as const
