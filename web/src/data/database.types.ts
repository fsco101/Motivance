export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          id: number
          recorded_at: string
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          id?: never
          recorded_at?: string
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          id?: never
          recorded_at?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          booking_id: string
          from_starts_at: string | null
          from_status: string | null
          from_therapist: string | null
          id: number
          reason: string | null
          recorded_at: string
          to_starts_at: string | null
          to_status: string | null
          to_therapist: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          booking_id: string
          from_starts_at?: string | null
          from_status?: string | null
          from_therapist?: string | null
          id?: never
          reason?: string | null
          recorded_at?: string
          to_starts_at?: string | null
          to_status?: string | null
          to_therapist?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          booking_id?: string
          from_starts_at?: string | null
          from_status?: string | null
          from_therapist?: string | null
          id?: never
          reason?: string | null
          recorded_at?: string
          to_starts_at?: string | null
          to_status?: string | null
          to_therapist?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          attendance: string | null
          attendance_at: string | null
          attendance_by: string | null
          calendar_token: string
          client_request_id: string | null
          created_at: string
          ends_at: string
          id: string
          patient_id: string
          previous_starts_at: string | null
          reference_no: string
          self_reschedules: number
          starts_at: string
          status: string
          status_reason: string | null
          therapist_id: string | null
          updated_at: string
        }
        Insert: {
          attendance?: string | null
          attendance_at?: string | null
          attendance_by?: string | null
          calendar_token?: string
          client_request_id?: string | null
          created_at?: string
          ends_at: string
          id?: string
          patient_id: string
          previous_starts_at?: string | null
          reference_no: string
          self_reschedules?: number
          starts_at: string
          status?: string
          status_reason?: string | null
          therapist_id?: string | null
          updated_at?: string
        }
        Update: {
          attendance?: string | null
          attendance_at?: string | null
          attendance_by?: string | null
          calendar_token?: string
          client_request_id?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          patient_id?: string
          previous_starts_at?: string | null
          reference_no?: string
          self_reschedules?: number
          starts_at?: string
          status?: string
          status_reason?: string | null
          therapist_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_attendance_by_fkey"
            columns: ["attendance_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      center_closures: {
        Row: {
          all_day: boolean
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          reason: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          reason: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          reason?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "center_closures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      center_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          kind: string
          name: string
          source: string
          starts_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          kind: string
          name: string
          source?: string
          starts_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          kind?: string
          name?: string
          source?: string
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "center_holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      center_hours: {
        Row: {
          closes_at: string
          is_open: boolean
          opens_at: string
          weekday: number
        }
        Insert: {
          closes_at?: string
          is_open?: boolean
          opens_at?: string
          weekday: number
        }
        Update: {
          closes_at?: string
          is_open?: boolean
          opens_at?: string
          weekday?: number
        }
        Relationships: []
      }
      center_settings: {
        Row: {
          booking_horizon_days: number
          cancel_cutoff_hours: number
          center_name: string
          id: boolean
          location: string
          max_active_bookings: number
          max_self_reschedules: number
          minimum_notice_hours: number
          reschedule_cutoff_hours: number
          slot_capacity: number
          slot_minutes: number
          time_zone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booking_horizon_days?: number
          cancel_cutoff_hours?: number
          center_name?: string
          id?: boolean
          location?: string
          max_active_bookings?: number
          max_self_reschedules?: number
          minimum_notice_hours?: number
          reschedule_cutoff_hours?: number
          slot_capacity?: number
          slot_minutes?: number
          time_zone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booking_horizon_days?: number
          cancel_cutoff_hours?: number
          center_name?: string
          id?: boolean
          location?: string
          max_active_bookings?: number
          max_self_reschedules?: number
          minimum_notice_hours?: number
          reschedule_cutoff_hours?: number
          slot_capacity?: number
          slot_minutes?: number
          time_zone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "center_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          client_event_id: string | null
          consent_type: string
          event: string
          id: string
          occurred_at: string
          patient_id: string
          recorded_at: string
          version: string
        }
        Insert: {
          client_event_id?: string | null
          consent_type: string
          event: string
          id?: string
          occurred_at?: string
          patient_id: string
          recorded_at?: string
          version: string
        }
        Update: {
          client_event_id?: string | null
          consent_type?: string
          event?: string
          id?: string
          occurred_at?: string
          patient_id?: string
          recorded_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      data_requests: {
        Row: {
          created_at: string
          id: string
          kind: string
          patient_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          patient_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          patient_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_assignments: {
        Row: {
          active: boolean
          created_at: string
          id: string
          patient_id: string
          therapist_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          patient_id: string
          therapist_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          patient_id?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_assignments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_assignments_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_assignments_therapist_id_patient_id_fkey"
            columns: ["therapist_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "therapist_patients"
            referencedColumns: ["therapist_id", "patient_id"]
          },
        ]
      }
      exercise_versions: {
        Row: {
          algorithm_key: string
          created_at: string
          definition: Json
          exercise_id: string
          id: string
          published: boolean
          version: number
        }
        Insert: {
          algorithm_key: string
          created_at?: string
          definition: Json
          exercise_id: string
          id?: string
          published?: boolean
          version: number
        }
        Update: {
          algorithm_key?: string
          created_at?: string
          definition?: Json
          exercise_id?: string
          id?: string
          published?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "exercise_versions_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          active: boolean
          code: string
          id: string
          owner_id: string | null
        }
        Insert: {
          active?: boolean
          code: string
          id?: string
          owner_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          id?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          therapist_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          therapist_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          therapist_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_invitations_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_profiles: {
        Row: {
          address: string
          avatar: string | null
          birthdate: string
          consented_at: string
          contact: string
          first_name: string | null
          full_name: string
          gender: string
          last_name: string | null
          privacy_version: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          address: string
          avatar?: string | null
          birthdate: string
          consented_at?: string
          contact: string
          first_name?: string | null
          full_name: string
          gender: string
          last_name?: string | null
          privacy_version?: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          address?: string
          avatar?: string | null
          birthdate?: string
          consented_at?: string
          contact?: string
          first_name?: string | null
          full_name?: string
          gender?: string
          last_name?: string | null
          privacy_version?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_versions: {
        Row: {
          assignment_id: string
          created_at: string
          created_by: string
          exercise_version_id: string
          id: string
          maximum_degrees: number
          minimum_degrees: number
          parameters: Json
          patient_id: string
          side: string
          target_repetitions: number
          version: number
        }
        Insert: {
          assignment_id: string
          created_at?: string
          created_by: string
          exercise_version_id: string
          id?: string
          maximum_degrees: number
          minimum_degrees: number
          parameters?: Json
          patient_id: string
          side: string
          target_repetitions: number
          version: number
        }
        Update: {
          assignment_id?: string
          created_at?: string
          created_by?: string
          exercise_version_id?: string
          id?: string
          maximum_degrees?: number
          minimum_degrees?: number
          parameters?: Json
          patient_id?: string
          side?: string
          target_repetitions?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prescription_versions_assignment_id_patient_id_fkey"
            columns: ["assignment_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "exercise_assignments"
            referencedColumns: ["id", "patient_id"]
          },
          {
            foreignKeyName: "prescription_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_versions_exercise_version_id_fkey"
            columns: ["exercise_version_id"]
            isOneToOne: false
            referencedRelation: "exercise_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_photo_uploads: {
        Row: {
          deleted_at: string | null
          issued_at: string
          public_id: string
          retired_at: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string | null
          issued_at?: string
          public_id: string
          retired_at?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string | null
          issued_at?: string
          public_id?: string
          retired_at?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_photo_uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          display_name: string
          id: string
          locale: string
          photo_url: string | null
        }
        Insert: {
          active?: boolean
          display_name?: string
          id: string
          locale?: string
          photo_url?: string | null
        }
        Update: {
          active?: boolean
          display_name?: string
          id?: string
          locale?: string
          photo_url?: string | null
        }
        Relationships: []
      }
      retention_policy: {
        Row: {
          automatic_deletion: boolean
          id: boolean
          policy_version: string
          review_after_days: number
        }
        Insert: {
          automatic_deletion?: boolean
          id?: boolean
          policy_version?: string
          review_after_days?: number
        }
        Update: {
          automatic_deletion?: boolean
          id?: boolean
          policy_version?: string
          review_after_days?: number
        }
        Relationships: []
      }
      session_measurements: {
        Row: {
          completed_repetitions: number
          failure_reasons: Json
          incomplete_repetitions: number
          invalid_frames: number
          maximum_degrees: number | null
          metric_key: string
          minimum_degrees: number | null
          quality: string
          rom_degrees: number | null
          session_id: string
          side: string
          valid_frames: number
        }
        Insert: {
          completed_repetitions: number
          failure_reasons?: Json
          incomplete_repetitions?: number
          invalid_frames?: number
          maximum_degrees?: number | null
          metric_key: string
          minimum_degrees?: number | null
          quality: string
          rom_degrees?: number | null
          session_id: string
          side: string
          valid_frames?: number
        }
        Update: {
          completed_repetitions?: number
          failure_reasons?: Json
          incomplete_repetitions?: number
          invalid_frames?: number
          maximum_degrees?: number | null
          metric_key?: string
          minimum_degrees?: number | null
          quality?: string
          rom_degrees?: number | null
          session_id?: string
          side?: string
          valid_frames?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_measurements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          algorithm_version: string
          app_version: string
          consent_event_id: string | null
          duration_ms: number
          ended_at: string
          id: string
          model_version: string
          patient_id: string
          payload_hash: string | null
          prescription_version_id: string
          started_at: string
          status: string
        }
        Insert: {
          algorithm_version: string
          app_version: string
          consent_event_id?: string | null
          duration_ms?: number
          ended_at: string
          id: string
          model_version: string
          patient_id: string
          payload_hash?: string | null
          prescription_version_id: string
          started_at: string
          status: string
        }
        Update: {
          algorithm_version?: string
          app_version?: string
          consent_event_id?: string | null
          duration_ms?: number
          ended_at?: string
          id?: string
          model_version?: string
          patient_id?: string
          payload_hash?: string | null
          prescription_version_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_consent_event_id_fkey"
            columns: ["consent_event_id"]
            isOneToOne: false
            referencedRelation: "consents"
            referencedColumns: ["client_event_id"]
          },
          {
            foreignKeyName: "sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_prescription_version_id_patient_id_fkey"
            columns: ["prescription_version_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "prescription_versions"
            referencedColumns: ["id", "patient_id"]
          },
        ]
      }
      therapist_patients: {
        Row: {
          active: boolean
          assigned_by: string | null
          patient_id: string
          therapist_id: string
        }
        Insert: {
          active?: boolean
          assigned_by?: string | null
          patient_id: string
          therapist_id: string
        }
        Update: {
          active?: boolean
          assigned_by?: string | null
          patient_id?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "therapist_patients_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "therapist_patients_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "therapist_patients_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_patient_invitation: {
        Args: { p_code: string }
        Returns: string
      }
      admin_accounts: {
        Args: { p_after?: string; p_search?: string }
        Returns: Json
      }
      admin_activity: {
        Args: { p_before?: number }
        Returns: Json
      }
      admin_clear_photo: {
        Args: { p_user: string }
        Returns: undefined
      }
      admin_links: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      admin_publish_exercise: {
        Args: {
          p_exercise: string
          p_name: string
          p_english: string
          p_filipino: string
        }
        Returns: string
      }
      admin_set_account: {
        Args: { p_user: string; p_active: boolean }
        Returns: undefined
      }
      admin_set_exercise: {
        Args: { p_exercise: string; p_active: boolean }
        Returns: undefined
      }
      admin_set_link: {
        Args: { p_therapist: string; p_patient: string; p_active: boolean }
        Returns: undefined
      }
      admin_set_role: {
        Args: { p_user: string; p_role: string; p_granted: boolean }
        Returns: undefined
      }
      admin_summary: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      archive_custom_exercise: {
        Args: { p_exercise: string }
        Returns: undefined
      }
      booking_availability: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      booking_check_patient: {
        Args: {
          p_patient: string
          p_starts: string
          p_ends: string
          p_booking: string
        }
        Returns: undefined
      }
      booking_check_slot: {
        Args: { p_starts: string; p_ends: string; p_booking: string }
        Returns: undefined
      }
      booking_check_therapist: {
        Args: {
          p_therapist: string
          p_starts: string
          p_ends: string
          p_booking: string
        }
        Returns: undefined
      }
      booking_reason: {
        Args: { p_reason: string }
        Returns: string
      }
      booking_view: {
        Args: { b: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: Json
      }
      calendar_affected: {
        Args: { p_starts: string; p_ends: string }
        Returns: {
          attendance: string | null
          attendance_at: string | null
          attendance_by: string | null
          calendar_token: string
          client_request_id: string | null
          created_at: string
          ends_at: string
          id: string
          patient_id: string
          previous_starts_at: string | null
          reference_no: string
          self_reschedules: number
          starts_at: string
          status: string
          status_reason: string | null
          therapist_id: string | null
          updated_at: string
        }[]
      }
      calendar_outside_hours: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      calendar_resolve: {
        Args: { p_starts: string; p_ends: string; p_resolutions: Json }
        Returns: number
      }
      can_prescribe: {
        Args: { target: string }
        Returns: boolean
      }
      can_read_exercise: {
        Args: { target: string }
        Returns: boolean
      }
      can_read_patient: {
        Args: { target: string }
        Returns: boolean
      }
      cancel_my_booking: {
        Args: { p_booking: string; p_reason?: string }
        Returns: Json
      }
      center_availability: {
        Args: { p_from: string; p_to: string; p_staff: boolean }
        Returns: Json
      }
      center_day_start: {
        Args: { p_day: string }
        Returns: string
      }
      center_problem: {
        Args: { p_starts: string; p_ends: string }
        Returns: string
      }
      clear_my_profile_photo: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      clear_profile_photo: {
        Args: { p_user: string }
        Returns: undefined
      }
      cloudinary_setting: {
        Args: { p_name: string }
        Returns: string
      }
      cloudinary_sign: {
        Args: { p_payload: string; p_secret: string; p_algorithm?: string }
        Returns: string
      }
      create_custom_exercise: {
        Args: {
          p_id: string
          p_name: string
          p_joint: string
          p_english: string
          p_filipino?: string
        }
        Returns: string
      }
      has_role: {
        Args: { wanted: string }
        Returns: boolean
      }
      ingest_session: {
        Args: { p_payload: Json }
        Returns: Json
      }
      invite_patient: {
        Args: { p_email: string }
        Returns: Json
      }
      is_active_user: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      my_booking_view: {
        Args: { b: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: Json
      }
      my_bookings: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      my_schedule: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      profile_photo_upload: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      publish_prescription: {
        Args: {
          p_assignment: string
          p_version: string
          p_patient: string
          p_exercise: string
          p_side: string
          p_low: number
          p_high: number
          p_repetitions: number
          p_parameters?: Json
        }
        Returns: string
      }
      record_consent: {
        Args: {
          p_id: string
          p_event: string
          p_version: string
          p_occurred_at: string
        }
        Returns: string
      }
      release_therapist_bookings: {
        Args: { p_therapist: string }
        Returns: undefined
      }
      request_booking: {
        Args: { p_request: string; p_starts: string }
        Returns: Json
      }
      request_patient_data: {
        Args: { p_id: string; p_kind: string }
        Returns: string
      }
      require_admin: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      require_scheduler: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      revoke_patient_link: {
        Args: { p_patient: string }
        Returns: undefined
      }
      save_my_profile: {
        Args: { p_details: Json }
        Returns: undefined
      }
      schedule_layout: {
        Args: {
          p_from: string
          p_to: string
          p_owner: string
          p_therapist: boolean
        }
        Returns: Json
      }
      schedule_view: {
        Args: {
          b: Database["public"]["Tables"]["bookings"]["Row"]
          p_therapist: boolean
        }
        Returns: Json
      }
      scheduler_assign_therapist: {
        Args: { p_booking: string; p_therapist: string }
        Returns: Json
      }
      scheduler_availability: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      scheduler_booking_detail: {
        Args: { p_booking: string }
        Returns: Json
      }
      scheduler_bookings: {
        Args: {
          p_search?: string
          p_statuses?: string[]
          p_from?: string
          p_to?: string
          p_therapist?: string
          p_patient?: string
          p_sort?: string
          p_descending?: boolean
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      scheduler_bulk_reject: {
        Args: { p_bookings: string[]; p_reason: string }
        Returns: number
      }
      scheduler_calendar_impact: {
        Args: { p_starts: string; p_ends: string }
        Returns: Json
      }
      scheduler_cancel: {
        Args: { p_booking: string; p_reason: string }
        Returns: Json
      }
      scheduler_confirm: {
        Args: { p_booking: string; p_therapist?: string }
        Returns: Json
      }
      scheduler_delete_closure: {
        Args: { p_id: string }
        Returns: undefined
      }
      scheduler_delete_holiday: {
        Args: { p_id: string }
        Returns: undefined
      }
      scheduler_patients: {
        Args: { p_search?: string; p_limit?: number }
        Returns: Json
      }
      scheduler_reject: {
        Args: { p_booking: string; p_reason: string }
        Returns: Json
      }
      scheduler_reschedule: {
        Args: {
          p_booking: string
          p_starts: string
          p_therapist?: string
          p_reason?: string
        }
        Returns: Json
      }
      scheduler_save_closure: {
        Args: {
          p_id: string
          p_starts: string
          p_ends: string
          p_all_day: boolean
          p_reason: string
          p_resolutions?: Json
        }
        Returns: Json
      }
      scheduler_save_holiday: {
        Args: {
          p_id: string
          p_name: string
          p_kind: string
          p_starts_on: string
          p_ends_on: string
          p_resolutions?: Json
        }
        Returns: Json
      }
      scheduler_save_hours: {
        Args: { p_hours: Json }
        Returns: Json
      }
      scheduler_save_settings: {
        Args: {
          p_center_name: string
          p_location: string
          p_slot_minutes: number
          p_slot_capacity: number
          p_cancel_cutoff_hours: number
          p_reschedule_cutoff_hours: number
          p_minimum_notice_hours: number
          p_booking_horizon_days: number
          p_max_active_bookings: number
          p_max_self_reschedules: number
        }
        Returns: Json
      }
      scheduler_therapists: {
        Args: { p_booking?: string; p_starts?: string }
        Returns: Json
      }
      set_my_profile_photo: {
        Args: { p_public_id: string; p_version: number; p_signature: string }
        Returns: string
      }
      slot_load: {
        Args: { p_starts: string; p_ends: string }
        Returns: number
      }
      slot_on_grid: {
        Args: { p_starts: string }
        Returns: boolean
      }
      slot_problem: {
        Args: { p_starts: string }
        Returns: string
      }
      therapist_schedule: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      username_allowed: {
        Args: { value: string }
        Returns: boolean
      }
      write_patient_profile: {
        Args: { p_user: string; p_details: Json }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

