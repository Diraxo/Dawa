export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          clerk_id: string
          email: string
          full_name: string | null
          phone: string | null
          profile_photo_url: string | null
          role: 'patient' | 'doctor' | 'admin'
          country: string | null
          language: string | null
          is_suspended: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          clerk_id: string
          email: string
          full_name?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          role?: 'patient' | 'doctor' | 'admin'
          country?: string | null
          language?: string | null
          is_suspended?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          clerk_id?: string
          email?: string
          full_name?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          role?: 'patient' | 'doctor' | 'admin'
          country?: string | null
          language?: string | null
          is_suspended?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      patient_profiles: {
        Row: {
          id: string
          user_id: string
          date_of_birth: string | null
          gender: string | null
        }
        Insert: {
          id?: string
          user_id: string
          date_of_birth?: string | null
          gender?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          date_of_birth?: string | null
          gender?: string | null
        }
        Relationships: []
      }
      doctor_profiles: {
        Row: {
          id: string
          user_id: string
          license_number: string | null
          specialty: string
          years_experience: number | null
          hospital_name: string | null
          bio: string | null
          license_doc_url: string | null
          id_doc_url: string | null
          status: 'pending' | 'approved' | 'rejected' | 'suspended'
          rejection_reason: string | null
          approved_at: string | null
          chat_price: number
          phone_price: number
          video_price: number
          is_online: boolean
          rating_average: number
          total_consultations: number
          date_of_birth: string | null
          gender: string | null
          availability: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          license_number?: string | null
          specialty: string
          years_experience?: number | null
          hospital_name?: string | null
          bio?: string | null
          license_doc_url?: string | null
          id_doc_url?: string | null
          status?: 'pending' | 'approved' | 'rejected' | 'suspended'
          rejection_reason?: string | null
          approved_at?: string | null
          chat_price?: number
          phone_price?: number
          video_price?: number
          is_online?: boolean
          rating_average?: number
          total_consultations?: number
          date_of_birth?: string | null
          gender?: string | null
          availability?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          license_number?: string | null
          specialty?: string
          years_experience?: number | null
          hospital_name?: string | null
          bio?: string | null
          license_doc_url?: string | null
          id_doc_url?: string | null
          status?: 'pending' | 'approved' | 'rejected' | 'suspended'
          rejection_reason?: string | null
          approved_at?: string | null
          chat_price?: number
          phone_price?: number
          video_price?: number
          is_online?: boolean
          rating_average?: number
          total_consultations?: number
          date_of_birth?: string | null
          gender?: string | null
          availability?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      consultations: {
        Row: {
          id: string
          patient_id: string
          doctor_id: string
          type: 'chat' | 'phone' | 'video'
          status: 'pending' | 'pending_payment' | 'active' | 'completed' | 'cancelled' | 'waiting_for_doctor' | 'accepted' | 'in_progress' | 'declined'
          scheduled_at: string | null
          started_at: string | null
          ended_at: string | null
          duration_minutes: number | null
          patient_amount: number
          doctor_amount: number
          platform_amount: number
          payment_status: 'pending' | 'paid'
          consultation_credit: boolean | null
          credit_amount: number | null
          credit_used: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          doctor_id: string
          type: 'chat' | 'phone' | 'video'
          status?: 'pending' | 'pending_payment' | 'active' | 'completed' | 'cancelled' | 'waiting_for_doctor' | 'accepted' | 'in_progress' | 'declined'
          scheduled_at?: string | null
          started_at?: string | null
          ended_at?: string | null
          duration_minutes?: number | null
          patient_amount?: number
          doctor_amount?: number
          platform_amount?: number
          payment_status?: 'pending' | 'paid'
          consultation_credit?: boolean | null
          credit_amount?: number | null
          credit_used?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          patient_id?: string
          doctor_id?: string
          type?: 'chat' | 'phone' | 'video'
          status?: 'pending' | 'pending_payment' | 'active' | 'completed' | 'cancelled' | 'waiting_for_doctor' | 'accepted' | 'in_progress' | 'declined'
          scheduled_at?: string | null
          started_at?: string | null
          ended_at?: string | null
          duration_minutes?: number | null
          patient_amount?: number
          doctor_amount?: number
          platform_amount?: number
          payment_status?: 'pending' | 'paid'
          consultation_credit?: boolean | null
          credit_amount?: number | null
          credit_used?: boolean | null
          created_at?: string
        }
        Relationships: []
      }
      consultation_summaries: {
        Row: {
          id: string
          consultation_id: string
          chief_complaint: string | null
          diagnosis: string | null
          prescription: string | null
          followup_recommendation: string | null
          referral_needed: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          consultation_id: string
          chief_complaint?: string | null
          diagnosis?: string | null
          prescription?: string | null
          followup_recommendation?: string | null
          referral_needed?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          consultation_id?: string
          chief_complaint?: string | null
          diagnosis?: string | null
          prescription?: string | null
          followup_recommendation?: string | null
          referral_needed?: boolean | null
          created_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          consultation_id: string
          sender_id: string
          content: string | null
          type: 'text' | 'image' | 'voice'
          file_url: string | null
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          consultation_id: string
          sender_id: string
          content?: string | null
          type?: 'text' | 'image' | 'voice'
          file_url?: string | null
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          consultation_id?: string
          sender_id?: string
          content?: string | null
          type?: 'text' | 'image' | 'voice'
          file_url?: string | null
          created_at?: string
          read_at?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: string
          consultation_id: string
          patient_id: string
          doctor_id: string
          rating: number
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          consultation_id: string
          patient_id: string
          doctor_id: string
          rating: number
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          consultation_id?: string
          patient_id?: string
          doctor_id?: string
          rating?: number
          comment?: string | null
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          body: string
          type: string
          data_json: Json | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          body: string
          type: string
          data_json?: Json | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          body?: string
          type?: string
          data_json?: Json | null
          read_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          id: string
          user_id: string
          consultation_request: boolean
          messages: boolean
          appointment_reminder: boolean
          consultation_summary: boolean
          promotions: boolean
          health_tips: boolean
          account: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          consultation_request?: boolean
          messages?: boolean
          appointment_reminder?: boolean
          consultation_summary?: boolean
          promotions?: boolean
          health_tips?: boolean
          account?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          consultation_request?: boolean
          messages?: boolean
          appointment_reminder?: boolean
          consultation_summary?: boolean
          promotions?: boolean
          health_tips?: boolean
          account?: boolean
          created_at?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          id: string
          doctor_id: string
          amount: number
          status: 'pending' | 'approved' | 'paid' | 'rejected' | 'processed'
          bank_details: string | null
          requested_at: string
          processed_at: string | null
        }
        Insert: {
          id?: string
          doctor_id: string
          amount: number
          status?: 'pending' | 'approved' | 'paid' | 'rejected'
          bank_details?: string | null
          requested_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: string
          doctor_id?: string
          amount?: number
          status?: 'pending' | 'approved' | 'paid' | 'rejected'
          bank_details?: string | null
          requested_at?: string
          processed_at?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          value: Json
          updated_at: string
        }
        Insert: {
          key: string
          value: Json
          updated_at?: string
        }
        Update: {
          key?: string
          value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      specialties: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          id: string
          platform: 'android' | 'ios'
          min_required_version: string
          latest_version: string
          update_message: string
          store_url: string
          updated_at: string
        }
        Insert: {
          id?: string
          platform: 'android' | 'ios'
          min_required_version?: string
          latest_version?: string
          update_message?: string
          store_url?: string
          updated_at?: string
        }
        Update: {
          id?: string
          platform?: 'android' | 'ios'
          min_required_version?: string
          latest_version?: string
          update_message?: string
          store_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_logs: {
        Row: {
          id: string
          admin_id: string | null
          action: string
          ip: string | null
          user_agent: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          admin_id?: string | null
          action: string
          ip?: string | null
          user_agent?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          admin_id?: string | null
          action?: string
          ip?: string | null
          user_agent?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
