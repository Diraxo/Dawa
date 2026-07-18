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
      admin_logs: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          id: number
          latest_version: string
          min_required_version: string
          platform: string
          store_url: string
          update_message: string
          updated_at: string
        }
        Insert: {
          id?: never
          latest_version: string
          min_required_version: string
          platform: string
          store_url?: string
          update_message?: string
          updated_at?: string
        }
        Update: {
          id?: never
          latest_version?: string
          min_required_version?: string
          platform?: string
          store_url?: string
          update_message?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_clerk_id: string | null
          actor_id: string | null
          actor_role: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          new_value: Json | null
          old_value: Json | null
          timestamp: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_clerk_id?: string | null
          actor_id?: string | null
          actor_role?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
          timestamp?: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_clerk_id?: string | null
          actor_id?: string | null
          actor_role?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
          timestamp?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_reports: {
        Row: {
          consultation_id: string | null
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_clerk_id: string
          reporter_role: string
          status: string
        }
        Insert: {
          consultation_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_clerk_id: string
          reporter_role: string
          status?: string
        }
        Update: {
          consultation_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_clerk_id?: string
          reporter_role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_reports_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_summaries: {
        Row: {
          chief_complaint: string | null
          consultation_id: string
          created_at: string | null
          diagnosis: string | null
          followup_recommendation: string | null
          id: string
          prescription: string | null
          referral_needed: boolean | null
          referral_specialty: string | null
          report_pdf_path: string | null
          updated_at: string
        }
        Insert: {
          chief_complaint?: string | null
          consultation_id: string
          created_at?: string | null
          diagnosis?: string | null
          followup_recommendation?: string | null
          id?: string
          prescription?: string | null
          referral_needed?: boolean | null
          referral_specialty?: string | null
          report_pdf_path?: string | null
          updated_at?: string
        }
        Update: {
          chief_complaint?: string | null
          consultation_id?: string
          created_at?: string | null
          diagnosis?: string | null
          followup_recommendation?: string | null
          id?: string
          prescription?: string | null
          referral_needed?: boolean | null
          referral_specialty?: string | null
          report_pdf_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_summaries_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: true
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          cancelled_by: string | null
          chapa_tx_ref: string | null
          consultation_credit: boolean
          created_at: string | null
          credit_amount: number | null
          credit_source_id: string | null
          credit_used: boolean
          decline_reason: string | null
          declined_at: string | null
          declined_by: string | null
          doctor_amount: number | null
          doctor_connected_at: string | null
          doctor_id: string
          doctor_viewed_at: string | null
          duration_minutes: number | null
          ended_at: string | null
          id: string
          is_on_demand: boolean | null
          last_heartbeat_at: string | null
          missed_at: string | null
          notification_sent: boolean
          patient_amount: number | null
          patient_connected_at: string | null
          patient_id: string
          patient_left_at: string | null
          payment_status: string | null
          platform_amount: number | null
          previous_scheduled_at: string | null
          refund_status: string
          reminder_30_sent: boolean
          reminder_10_sent: boolean
          reminder_sent: boolean
          replacement_consultation_id: string | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          status_changed_at: string
          type: string
          updated_at: string | null
          waiting_started_at: string | null
        }
        Insert: {
          cancelled_by?: string | null
          chapa_tx_ref?: string | null
          consultation_credit?: boolean
          created_at?: string | null
          credit_amount?: number | null
          credit_source_id?: string | null
          credit_used?: boolean
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          doctor_amount?: number | null
          doctor_connected_at?: string | null
          doctor_id: string
          doctor_viewed_at?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          is_on_demand?: boolean | null
          last_heartbeat_at?: string | null
          missed_at?: string | null
          notification_sent?: boolean
          patient_amount?: number | null
          patient_connected_at?: string | null
          patient_id: string
          patient_left_at?: string | null
          payment_status?: string | null
          platform_amount?: number | null
          previous_scheduled_at?: string | null
          refund_status?: string
          reminder_30_sent?: boolean
          reminder_10_sent?: boolean
          reminder_sent?: boolean
          replacement_consultation_id?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          status_changed_at?: string
          type: string
          updated_at?: string | null
          waiting_started_at?: string | null
        }
        Update: {
          cancelled_by?: string | null
          chapa_tx_ref?: string | null
          consultation_credit?: boolean
          created_at?: string | null
          credit_amount?: number | null
          credit_source_id?: string | null
          credit_used?: boolean
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          doctor_amount?: number | null
          doctor_connected_at?: string | null
          doctor_id?: string
          doctor_viewed_at?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          is_on_demand?: boolean | null
          last_heartbeat_at?: string | null
          missed_at?: string | null
          notification_sent?: boolean
          patient_amount?: number | null
          patient_connected_at?: string | null
          patient_id?: string
          patient_left_at?: string | null
          payment_status?: string | null
          platform_amount?: number | null
          previous_scheduled_at?: string | null
          refund_status?: string
          reminder_30_sent?: boolean
          reminder_10_sent?: boolean
          reminder_sent?: boolean
          replacement_consultation_id?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          status_changed_at?: string
          type?: string
          updated_at?: string | null
          waiting_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_credit_source_id_fkey"
            columns: ["credit_source_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_declined_by_fkey"
            columns: ["declined_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_replacement_consultation_id_fkey"
            columns: ["replacement_consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      doctor_profiles: {
        Row: {
          approved_at: string | null
          availability: Json | null
          bio: string | null
          chat_price: number | null
          created_at: string | null
          date_of_birth: string | null
          gender: string | null
          hospital_name: string | null
          id: string
          id_doc_url: string | null
          is_online: boolean | null
          languages: string[] | null
          last_seen_at: string | null
          license_doc_url: string | null
          license_number: string | null
          phone_price: number | null
          rating_average: number | null
          rejection_reason: string | null
          review_count: number
          specialty: string | null
          status: string
          status_ack: boolean
          total_consultations: number | null
          user_id: string
          video_price: number | null
          years_experience: number | null
        }
        Insert: {
          approved_at?: string | null
          availability?: Json | null
          bio?: string | null
          chat_price?: number | null
          created_at?: string | null
          date_of_birth?: string | null
          gender?: string | null
          hospital_name?: string | null
          id?: string
          id_doc_url?: string | null
          is_online?: boolean | null
          languages?: string[] | null
          last_seen_at?: string | null
          license_doc_url?: string | null
          license_number?: string | null
          phone_price?: number | null
          rating_average?: number | null
          rejection_reason?: string | null
          review_count?: number
          specialty?: string | null
          status?: string
          status_ack?: boolean
          total_consultations?: number | null
          user_id: string
          video_price?: number | null
          years_experience?: number | null
        }
        Update: {
          approved_at?: string | null
          availability?: Json | null
          bio?: string | null
          chat_price?: number | null
          created_at?: string | null
          date_of_birth?: string | null
          gender?: string | null
          hospital_name?: string | null
          id?: string
          id_doc_url?: string | null
          is_online?: boolean | null
          languages?: string[] | null
          last_seen_at?: string | null
          license_doc_url?: string | null
          license_number?: string | null
          phone_price?: number | null
          rating_average?: number | null
          rejection_reason?: string | null
          review_count?: number
          specialty?: string | null
          status?: string
          status_ack?: boolean
          total_consultations?: number | null
          user_id?: string
          video_price?: number | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "doctor_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_reminders: {
        Row: {
          consultation_id: string
          created_at: string
          doctor_id: string
          id: string
          message: string | null
          patient_id: string
          remind_at: string
          sent: boolean
          sent_at: string | null
        }
        Insert: {
          consultation_id: string
          created_at?: string
          doctor_id: string
          id?: string
          message?: string | null
          patient_id: string
          remind_at: string
          sent?: boolean
          sent_at?: string | null
        }
        Update: {
          consultation_id?: string
          created_at?: string
          doctor_id?: string
          id?: string
          message?: string | null
          patient_id?: string
          remind_at?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followup_reminders_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_reminders_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_reminders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          consultation_id: string
          content: string | null
          created_at: string | null
          file_url: string | null
          id: string
          read_at: string | null
          sender_id: string
          type: string
        }
        Insert: {
          consultation_id: string
          content?: string | null
          created_at?: string | null
          file_url?: string | null
          id?: string
          read_at?: string | null
          sender_id: string
          type?: string
        }
        Update: {
          consultation_id?: string
          content?: string | null
          created_at?: string | null
          file_url?: string | null
          id?: string
          read_at?: string | null
          sender_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          account: boolean
          announcements: boolean
          appointment_reminder: boolean
          consultation_request: boolean
          consultation_summary: boolean
          consultation_update: boolean
          earnings: boolean
          health_tips: boolean
          id: string
          messages: boolean
          promotions: boolean
          reviews: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account?: boolean
          announcements?: boolean
          appointment_reminder?: boolean
          consultation_request?: boolean
          consultation_summary?: boolean
          consultation_update?: boolean
          earnings?: boolean
          health_tips?: boolean
          id?: string
          messages?: boolean
          promotions?: boolean
          reviews?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account?: boolean
          announcements?: boolean
          appointment_reminder?: boolean
          consultation_request?: boolean
          consultation_summary?: boolean
          consultation_update?: boolean
          earnings?: boolean
          health_tips?: boolean
          id?: string
          messages?: boolean
          promotions?: boolean
          reviews?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          data_json: Json | null
          id: string
          read_at: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string | null
          data_json?: Json | null
          id?: string
          read_at?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string | null
          data_json?: Json | null
          id?: string
          read_at?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_profiles: {
        Row: {
          date_of_birth: string | null
          gender: string | null
          id: string
          user_id: string
        }
        Insert: {
          date_of_birth?: string | null
          gender?: string | null
          id?: string
          user_id: string
        }
        Update: {
          date_of_birth?: string | null
          gender?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          attempt_type: string
          count: number
          first_attempt_at: string
          identifier: string
          last_attempt_at: string
          locked_until: string | null
        }
        Insert: {
          attempt_type?: string
          count?: number
          first_attempt_at?: string
          identifier: string
          last_attempt_at?: string
          locked_until?: string | null
        }
        Update: {
          attempt_type?: string
          count?: number
          first_attempt_at?: string
          identifier?: string
          last_attempt_at?: string
          locked_until?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          consultation_id: string
          created_at: string | null
          doctor_id: string
          hidden: boolean
          hidden_reason: string | null
          id: string
          patient_id: string
          rating: number
        }
        Insert: {
          comment?: string | null
          consultation_id: string
          created_at?: string | null
          doctor_id: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          patient_id: string
          rating: number
        }
        Update: {
          comment?: string | null
          consultation_id?: string
          created_at?: string | null
          doctor_id?: string
          hidden?: boolean
          hidden_reason?: string | null
          id?: string
          patient_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: true
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_locks: {
        Row: {
          consultation_id: string | null
          doctor_id: string
          expires_at: string
          id: string
          locked_at: string
          slot_duration: number
          slot_start: string
        }
        Insert: {
          consultation_id?: string | null
          doctor_id: string
          expires_at?: string
          id?: string
          locked_at?: string
          slot_duration?: number
          slot_start: string
        }
        Update: {
          consultation_id?: string | null
          doctor_id?: string
          expires_at?: string
          id?: string
          locked_at?: string
          slot_duration?: number
          slot_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_locks_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_locks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      specialties: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          address: string | null
          clerk_id: string | null
          country: string | null
          created_at: string | null
          email: string
          fcm_token: string | null
          full_name: string | null
          id: string
          is_suspended: boolean
          language: string | null
          phone: string | null
          profile_photo_url: string | null
          push_token: string | null
          role: string
          updated_at: string | null
          voip_token: string | null
        }
        Insert: {
          address?: string | null
          clerk_id?: string | null
          country?: string | null
          created_at?: string | null
          email: string
          fcm_token?: string | null
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          language?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          push_token?: string | null
          role?: string
          updated_at?: string | null
          voip_token?: string | null
        }
        Update: {
          address?: string | null
          clerk_id?: string | null
          country?: string | null
          created_at?: string | null
          email?: string
          fcm_token?: string | null
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          language?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          push_token?: string | null
          role?: string
          updated_at?: string | null
          voip_token?: string | null
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          amount: number
          bank_details: Json | null
          doctor_id: string
          id: string
          processed_at: string | null
          requested_at: string | null
          status: string
        }
        Insert: {
          amount: number
          bank_details?: Json | null
          doctor_id: string
          id?: string
          processed_at?: string | null
          requested_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          bank_details?: Json | null
          doctor_id?: string
          id?: string
          processed_at?: string | null
          requested_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _call_consultation_notification: {
        Args: { p_consultation_id: string; p_event: string; p_extra?: Json }
        Returns: undefined
      }
      _call_freeze_consultation_channel: {
        Args: { p_consultation_id: string }
        Returns: undefined
      }
      _parse_time_to_minutes: { Args: { p_time: string }; Returns: number }
      _validate_scheduled_slot: {
        Args: { p_avail: Json; p_slot_duration: number; p_slot_start: string }
        Returns: undefined
      }
      book_appointment_slot: {
        Args: {
          p_doctor_amount?: number
          p_doctor_id: string
          p_is_on_demand?: boolean
          p_patient_amount?: number
          p_patient_id: string
          p_platform_amount?: number
          p_slot_duration?: number
          p_slot_start: string
          p_type: string
        }
        Returns: string
      }
      get_commission_rate: { Args: never; Returns: number }
      get_on_demand_buffer_minutes: { Args: never; Returns: number }
      get_doctor_profile_id: { Args: never; Returns: string }
      get_doctor_reviews: {
        Args: { p_doctor_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          comment: string | null
          consultation_type: string | null
          created_at: string
          id: string
          patient_id: string
          patient_name: string
          patient_photo_url: string | null
          rating: number
        }[]
      }
      get_server_time: { Args: never; Returns: string }
      get_user_id_from_jwt_sub: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_doctor_busy: { Args: { p_doctor_id: string }; Returns: boolean }
      is_doctor_scheduled_soon: { Args: { p_doctor_id: string }; Returns: boolean }
      is_patient_busy: { Args: { p_patient_id: string }; Returns: boolean }
      is_slot_available: {
        Args: { p_doctor_id: string; p_slot_start: string }
        Returns: boolean
      }
      mark_doctor_missed_consultations: { Args: never; Returns: undefined }
      mark_missed_calls: { Args: never; Returns: undefined }
      mark_no_show_consultations: { Args: never; Returns: undefined }
      mark_stale_active_consultations: { Args: never; Returns: undefined }
      mark_stale_doctors_offline: { Args: never; Returns: undefined }
      process_followup_reminders: { Args: never; Returns: undefined }
      reschedule_appointment_slot: {
        Args: { p_consultation_id: string; p_new_slot_start: string }
        Returns: undefined
      }
      trigger_appointment_notifications: { Args: never; Returns: undefined }
      trigger_appointment_reminders: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
