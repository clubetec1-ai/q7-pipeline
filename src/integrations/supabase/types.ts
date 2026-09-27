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
          id: string
          name: string
          organization_id: string
          sensitive: boolean
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          sensitive?: boolean
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
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
          organization_id: string
          phone: string
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
          organization_id: string
          phone: string
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
          organization_id?: string
          phone?: string
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
          contact_id: string | null
          contact_name: string | null
          contact_phone: string
          created_at: string
          department_id: string | null
          human_takeover_at: string | null
          id: string
          inactivity_followup_at: string | null
          instance_id: string
          last_inbound_at: string | null
          last_message_at: string
          organization_id: string
          stage_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_enabled?: boolean
          assigned_to?: string | null
          auto_followup_count?: number
          contact_id?: string | null
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          department_id?: string | null
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          instance_id: string
          last_inbound_at?: string | null
          last_message_at?: string
          organization_id: string
          stage_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_enabled?: boolean
          assigned_to?: string | null
          auto_followup_count?: number
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          department_id?: string | null
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          instance_id?: string
          last_inbound_at?: string | null
          last_message_at?: string
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
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
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
            foreignKeyName: "followups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          direction: string
          error: string | null
          id: string
          media_mime: string | null
          media_name: string | null
          media_path: string | null
          media_size: number | null
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
          direction: string
          error?: string | null
          id?: string
          media_mime?: string | null
          media_name?: string | null
          media_path?: string | null
          media_size?: number | null
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
          direction?: string
          error?: string | null
          id?: string
          media_mime?: string | null
          media_name?: string | null
          media_path?: string | null
          media_size?: number | null
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
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          kind: string
          organization_id: string
          read_at: string | null
          ref: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          organization_id: string
          read_at?: string | null
          ref?: Json
          user_id: string
        }
        Update: {
          created_at?: string
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
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
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
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
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
          organization_id: string
          shortcut: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          organization_id: string
          shortcut: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
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
            foreignKeyName: "quick_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
      tags: {
        Row: {
          color: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          id?: string
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
          protocol: string
          queued_at?: string | null
          rating?: number | null
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
          protocol?: string
          queued_at?: string | null
          rating?: number | null
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heartbeat: { Args: { org: string }; Returns: undefined }
      my_invitations: {
        Args: never
        Returns: {
          organization_id: string
          organization_name: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      my_permissions: { Args: { org: string }; Returns: string[] }
      org_setup_status: { Args: { org: string }; Returns: Json }
      publish_flow: { Args: { flow: string }; Returns: number }
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
      seed_pipeline_stages: { Args: { _user_id: string }; Returns: undefined }
      service_can_add_number: { Args: { org: string }; Returns: boolean }
      service_delete_instance_secrets: {
        Args: { instance: string }
        Returns: undefined
      }
      service_get_secret: { Args: { secret_name: string }; Returns: string }
      service_has_secret: { Args: { secret_name: string }; Returns: boolean }
      service_put_secret: {
        Args: { secret_name: string; secret_value: string }
        Returns: undefined
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
      set_instance_secret: {
        Args: { instance: string; secret_value: string }
        Returns: undefined
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
      supervisor_dashboard: { Args: { org: string }; Returns: Json }
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
          protocol: string
          queued_at: string | null
          rating: number | null
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
