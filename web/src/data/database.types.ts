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
      backend_plan: {
        Row: {
          database_bytes: number
          id: boolean
          name: string
          storage_bytes: number
          updated_at: string
        }
        Insert: {
          database_bytes: number
          id?: boolean
          name: string
          storage_bytes: number
          updated_at?: string
        }
        Update: {
          database_bytes?: number
          id?: boolean
          name?: string
          storage_bytes?: number
          updated_at?: string
        }
        Relationships: []
      }
      booking_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          booking_id: string
          from_attendance: string | null
          from_starts_at: string | null
          from_status: string | null
          from_therapist: string | null
          id: number
          reason: string | null
          recorded_at: string
          to_attendance: string | null
          to_starts_at: string | null
          to_status: string | null
          to_therapist: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          booking_id: string
          from_attendance?: string | null
          from_starts_at?: string | null
          from_status?: string | null
          from_therapist?: string | null
          id?: never
          reason?: string | null
          recorded_at?: string
          to_attendance?: string | null
          to_starts_at?: string | null
          to_status?: string | null
          to_therapist?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          booking_id?: string
          from_attendance?: string | null
          from_starts_at?: string | null
          from_status?: string | null
          from_therapist?: string | null
          id?: never
          reason?: string | null
          recorded_at?: string
          to_attendance?: string | null
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
      booking_series: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          client_request_id: string | null
          created_at: string
          created_by: string | null
          id: string
          patient_id: string
          therapist_id: string
          weeks: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_request_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id: string
          therapist_id: string
          weeks: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_request_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id?: string
          therapist_id?: string
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_waitlist: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          notified_at: string | null
          patient_id: string
          settled_at: string | null
          starts_at: string
          status: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          notified_at?: string | null
          patient_id: string
          settled_at?: string | null
          starts_at: string
          status?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          notified_at?: string | null
          patient_id?: string
          settled_at?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_waitlist_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
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
          series_id: string | null
          starts_at: string
          status: string
          status_reason: string | null
          therapist_id: string | null
          updated_at: string
          visit_reason: string | null
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
          series_id?: string | null
          starts_at: string
          status?: string
          status_reason?: string | null
          therapist_id?: string | null
          updated_at?: string
          visit_reason?: string | null
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
          series_id?: string | null
          starts_at?: string
          status?: string
          status_reason?: string | null
          therapist_id?: string | null
          updated_at?: string
          visit_reason?: string | null
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
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
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
      chat_attachments: {
        Row: {
          bytes: number | null
          conversation_id: string
          created_at: string
          duration_ms: number | null
          expires_at: string | null
          height: number
          id: string
          kind: string
          media_path: string
          mime: string
          preview_bytes: number | null
          preview_path: string
          removed_at: string | null
          sent_at: string | null
          uploader_id: string
          width: number
        }
        Insert: {
          bytes?: number | null
          conversation_id: string
          created_at?: string
          duration_ms?: number | null
          expires_at?: string | null
          height: number
          id: string
          kind: string
          media_path: string
          mime: string
          preview_bytes?: number | null
          preview_path: string
          removed_at?: string | null
          sent_at?: string | null
          uploader_id: string
          width: number
        }
        Update: {
          bytes?: number | null
          conversation_id?: string
          created_at?: string
          duration_ms?: number | null
          expires_at?: string | null
          height?: number
          id?: string
          kind?: string
          media_path?: string
          mime?: string
          preview_bytes?: number | null
          preview_path?: string
          removed_at?: string | null
          sent_at?: string | null
          uploader_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_media_trash: {
        Row: {
          path: string
          queued_at: string
        }
        Insert: {
          path: string
          queued_at?: string
        }
        Update: {
          path?: string
          queued_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          kind: string
          sender_id: string | null
        }
        Insert: {
          body?: string
          conversation_id: string
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id: string
          kind: string
          sender_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          kind?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mutes: {
        Row: {
          conversation_id: string
          muted_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          muted_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          muted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_mutes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reads: {
        Row: {
          conversation_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_scheduled: {
        Row: {
          body: string
          cancelled_at: string | null
          conversation_id: string
          created_at: string
          dropped_reason: string | null
          id: string
          send_at: string
          sender_id: string
          sent_at: string | null
        }
        Insert: {
          body: string
          cancelled_at?: string | null
          conversation_id: string
          created_at?: string
          dropped_reason?: string | null
          id: string
          send_at: string
          sender_id: string
          sent_at?: string | null
        }
        Update: {
          body?: string
          cancelled_at?: string | null
          conversation_id?: string
          created_at?: string
          dropped_reason?: string | null
          id?: string
          send_at?: string
          sender_id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_scheduled_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_scheduled_sender_id_fkey"
            columns: ["sender_id"]
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
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          patient_id: string
          therapist_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          patient_id: string
          therapist_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          patient_id?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_therapist_id_patient_id_fkey"
            columns: ["therapist_id", "patient_id"]
            isOneToOne: true
            referencedRelation: "therapist_patients"
            referencedColumns: ["therapist_id", "patient_id"]
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
      device_tokens: {
        Row: {
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          schedule_id: string | null
          therapist_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          patient_id: string
          schedule_id?: string | null
          therapist_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          patient_id?: string
          schedule_id?: string | null
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
            foreignKeyName: "exercise_assignments_schedule_fkey"
            columns: ["schedule_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "exercise_schedules"
            referencedColumns: ["id", "patient_id"]
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
      exercise_day_results: {
        Row: {
          day: string
          done: number
          due: number
          missed: string[]
          notified_at: string | null
          patient_id: string
          recorded_at: string
          therapist_id: string
        }
        Insert: {
          day: string
          done: number
          due: number
          missed?: string[]
          notified_at?: string | null
          patient_id: string
          recorded_at?: string
          therapist_id: string
        }
        Update: {
          day?: string
          done?: number
          due?: number
          missed?: string[]
          notified_at?: string | null
          patient_id?: string
          recorded_at?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_day_results_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_day_results_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_schedules: {
        Row: {
          cancelled_at: string | null
          created_at: string
          ends_on: string
          id: string
          patient_id: string
          rest_dates: string[]
          rest_weekdays: number[]
          starts_on: string
          therapist_id: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          ends_on: string
          id: string
          patient_id: string
          rest_dates?: string[]
          rest_weekdays?: number[]
          starts_on: string
          therapist_id: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          patient_id?: string
          rest_dates?: string[]
          rest_weekdays?: number[]
          starts_on?: string
          therapist_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_schedules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_schedules_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_schedules_therapist_id_patient_id_fkey"
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
      notification_deliveries: {
        Row: {
          attempts: number
          channel: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          notification_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          channel: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          channel?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          bookings: boolean
          care_team: boolean
          exercise_plan: boolean
          inactivity: boolean
          messages: boolean
          missed_days: boolean
          reminder_time: string | null
          session_results: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          bookings?: boolean
          care_team?: boolean
          exercise_plan?: boolean
          inactivity?: boolean
          messages?: boolean
          missed_days?: boolean
          reminder_time?: string | null
          session_results?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          bookings?: boolean
          care_team?: boolean
          exercise_plan?: boolean
          inactivity?: boolean
          messages?: boolean
          missed_days?: boolean
          reminder_time?: string | null
          session_results?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          booking_id: string | null
          created_at: string
          data: Json
          dedupe_key: string
          id: string
          kind: string
          read_at: string | null
          subject_id: string | null
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          data?: Json
          dedupe_key: string
          id?: string
          kind: string
          read_at?: string | null
          subject_id?: string | null
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string
          id?: string
          kind?: string
          read_at?: string | null
          subject_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
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
          bytes: number | null
          deleted_at: string | null
          issued_at: string
          mime: string
          path: string
          retired_at: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          bytes?: number | null
          deleted_at?: string | null
          issued_at?: string
          mime: string
          path: string
          retired_at?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          bytes?: number | null
          deleted_at?: string | null
          issued_at?: string
          mime?: string
          path?: string
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
          preferred_language: string
        }
        Insert: {
          active?: boolean
          display_name?: string
          id: string
          locale?: string
          photo_url?: string | null
          preferred_language?: string
        }
        Update: {
          active?: boolean
          display_name?: string
          id?: string
          locale?: string
          photo_url?: string | null
          preferred_language?: string
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
      session_video_trash: {
        Row: {
          path: string
          queued_at: string
        }
        Insert: {
          path: string
          queued_at?: string
        }
        Update: {
          path?: string
          queued_at?: string
        }
        Relationships: []
      }
      session_videos: {
        Row: {
          bytes: number | null
          created_at: string
          duration_ms: number
          expires_at: string | null
          height: number
          id: string
          media_path: string
          patient_id: string
          preview_bytes: number | null
          preview_path: string
          removed_at: string | null
          session_id: string
          shared_at: string | null
          therapist_id: string
          width: number
        }
        Insert: {
          bytes?: number | null
          created_at?: string
          duration_ms: number
          expires_at?: string | null
          height: number
          id: string
          media_path: string
          patient_id: string
          preview_bytes?: number | null
          preview_path: string
          removed_at?: string | null
          session_id: string
          shared_at?: string | null
          therapist_id: string
          width: number
        }
        Update: {
          bytes?: number | null
          created_at?: string
          duration_ms?: number
          expires_at?: string | null
          height?: number
          id?: string
          media_path?: string
          patient_id?: string
          preview_bytes?: number | null
          preview_path?: string
          removed_at?: string | null
          session_id?: string
          shared_at?: string | null
          therapist_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_videos_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_videos_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_videos_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          algorithm_version: string
          app_version: string
          client: string
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
          client?: string
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
          client?: string
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
      therapist_time_off: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          reason: string
          starts_at: string
          therapist_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          reason: string
          starts_at: string
          therapist_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          reason?: string
          starts_at?: string
          therapist_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "therapist_time_off_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "therapist_time_off_therapist_id_fkey"
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
      admin_backend: {
        Args: Record<PropertyKey, never>
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
      assignment_done_between: {
        Args: {
          p_assignment: string
          p_patient: string
          p_from: string
          p_to: string
        }
        Returns: boolean
      }
      booking_availability: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      booking_calendar: {
        Args: { p_token: string }
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
        Args: { p_starts: string; p_ends: string; p_therapist?: string }
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
          series_id: string | null
          starts_at: string
          status: string
          status_reason: string | null
          therapist_id: string | null
          updated_at: string
          visit_reason: string | null
        }[]
      }
      calendar_outside_hours: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      calendar_resolve: {
        Args: {
          p_starts: string
          p_ends: string
          p_resolutions: Json
          p_therapist?: string
        }
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
      cancel_scheduled_message: {
        Args: { p_id: string }
        Returns: boolean
      }
      center_availability: {
        Args: { p_from: string; p_to: string; p_staff: boolean }
        Returns: Json
      }
      center_date: {
        Args: { p_at?: string }
        Returns: string
      }
      center_day_start: {
        Args: { p_day: string }
        Returns: string
      }
      center_problem: {
        Args: { p_starts: string; p_ends: string }
        Returns: string
      }
      chat_can_read: {
        Args: { p_conversation: string }
        Returns: boolean
      }
      chat_can_send: {
        Args: { p_conversation: string }
        Returns: boolean
      }
      chat_consent_version: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      chat_consented: {
        Args: { p_patient: string }
        Returns: boolean
      }
      chat_link_open: {
        Args: { p_conversation: string }
        Returns: boolean
      }
      chat_media_consented: {
        Args: { p_patient: string }
        Returns: boolean
      }
      chat_media_days: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      chat_media_due: {
        Args: { p_limit?: number }
        Returns: string[]
      }
      chat_media_extension: {
        Args: { p_mime: string }
        Returns: string
      }
      chat_media_limit: {
        Args: { p_kind: string }
        Returns: number
      }
      chat_media_readable: {
        Args: { p_path: string }
        Returns: boolean
      }
      chat_media_removed: {
        Args: { p_paths: string[] }
        Returns: number
      }
      chat_media_usage: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      chat_media_writable: {
        Args: { p_path: string }
        Returns: boolean
      }
      chat_message_json: {
        Args: { m: Database["public"]["Tables"]["chat_messages"]["Row"] }
        Returns: Json
      }
      chat_notice_window: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      chat_number: {
        Args: {
          p: Json
          p_key: string
          p_min: number
          p_max: number
          p_optional?: boolean
        }
        Returns: boolean
      }
      chat_open_between: {
        Args: { p_conversation: string }
        Returns: boolean
      }
      chat_progress_valid: {
        Args: { p: Json }
        Returns: boolean
      }
      chat_rate_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      chat_reading_window: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      chat_system_line: {
        Args: {
          p_conversation: string
          p_event: string
          p_facts: Json
          p_key: string
        }
        Returns: undefined
      }
      chat_video_cap: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      check_signup_details: {
        Args: { p_user: string; p_details: Json }
        Returns: undefined
      }
      claim_notification_deliveries: {
        Args: { p_channel?: string; p_limit?: number }
        Returns: Json
      }
      clear_my_profile_photo: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      clear_profile_photo: {
        Args: { p_user: string }
        Returns: undefined
      }
      conversation_messages: {
        Args: {
          p_conversation: string
          p_before_at?: string
          p_before_id?: string
        }
        Returns: Json
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
      delete_expired_signups: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      delete_message: {
        Args: { p_id: string }
        Returns: Json
      }
      dispatch_notifications: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      end_exercise_schedule: {
        Args: { p_schedule: string }
        Returns: Json
      }
      enqueue_booking_reminders: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      enqueue_inactivity_alerts: {
        Args: { p_now?: string }
        Returns: number
      }
      enqueue_practice_reminders: {
        Args: { p_now?: string }
        Returns: number
      }
      erase_patient_chat: {
        Args: { p_patient: string }
        Returns: number
      }
      exercise_day: {
        Args: { p_patient: string; p_day?: string }
        Returns: Json
      }
      expire_stale_bookings: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      export_patient_chat: {
        Args: { p_patient: string }
        Returns: Json
      }
      finish_notification_delivery: {
        Args: { p_id: string; p_sent: boolean; p_error?: string }
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
      join_waitlist: {
        Args: { p_starts: string }
        Returns: Json
      }
      leave_waitlist: {
        Args: { p_starts: string }
        Returns: undefined
      }
      mark_attendance: {
        Args: { p_booking: string; p_attendance: string }
        Returns: Json
      }
      mark_conversation_read: {
        Args: { p_conversation: string }
        Returns: undefined
      }
      mark_notifications_read: {
        Args: { p_ids?: string[] }
        Returns: number
      }
      my_booking_view: {
        Args: { b: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: Json
      }
      my_bookings: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      my_chat_consent: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      my_conversations: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      my_notification_settings: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      my_notifications: {
        Args: { p_limit?: number }
        Returns: Json
      }
      my_schedule: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      my_scheduled_messages: {
        Args: { p_conversation: string }
        Returns: Json
      }
      my_unread_messages: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      my_waitlist: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      notification_group: {
        Args: { p_kind: string }
        Returns: string
      }
      notify: {
        Args: {
          p_user: string
          p_kind: string
          p_booking: string
          p_data: Json
          p_event: number
          p_actor: string
        }
        Returns: undefined
      }
      notify_person: {
        Args: {
          p_user: string
          p_kind: string
          p_subject: string
          p_data: Json
          p_key: string
          p_actor: string
        }
        Returns: boolean
      }
      notify_schedulers: {
        Args: {
          p_kind: string
          p_booking: string
          p_data: Json
          p_event: number
          p_actor: string
        }
        Returns: undefined
      }
      person_name: {
        Args: { p_person: string }
        Returns: string
      }
      profile_photo_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      profile_photo_usage: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      profile_photo_writable: {
        Args: { p_path: string }
        Returns: boolean
      }
      profile_photos_due: {
        Args: { p_limit?: number }
        Returns: string[]
      }
      profile_photos_removed: {
        Args: { p_paths: string[] }
        Returns: number
      }
      provision_account: {
        Args: { p_user: string; p_metadata: Json }
        Returns: undefined
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
      publish_scheduled_prescription: {
        Args: {
          p_schedule: string
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
      record_exercise_days: {
        Args: { p_now?: string }
        Returns: number
      }
      register_device: {
        Args: { p_token: string; p_platform?: string }
        Returns: undefined
      }
      release_therapist_bookings: {
        Args: { p_therapist: string }
        Returns: undefined
      }
      remove_device_tokens: {
        Args: { p_tokens: string[] }
        Returns: number
      }
      request_booking: {
        Args: { p_request: string; p_starts: string; p_reason?: string }
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
      reschedule_my_booking: {
        Args: { p_booking: string; p_starts: string }
        Returns: Json
      }
      revoke_patient_link: {
        Args: { p_patient: string }
        Returns: undefined
      }
      save_exercise_schedule: {
        Args: {
          p_id: string
          p_patient: string
          p_starts_on: string
          p_ends_on: string
          p_rest_weekdays?: number[]
          p_rest_dates?: string[]
        }
        Returns: Json
      }
      save_my_profile: {
        Args: { p_details: Json }
        Returns: undefined
      }
      save_notification_settings: {
        Args: {
          p_bookings: boolean
          p_exercise_plan: boolean
          p_session_results: boolean
          p_inactivity: boolean
          p_care_team: boolean
          p_reminder_time?: string
          p_messages?: boolean
          p_missed_days?: boolean
        }
        Returns: Json
      }
      schedule_day_count: {
        Args: {
          s: Database["public"]["Tables"]["exercise_schedules"]["Row"]
          p_from: string
        }
        Returns: number
      }
      schedule_has_day: {
        Args: {
          s: Database["public"]["Tables"]["exercise_schedules"]["Row"]
          p_day: string
        }
        Returns: boolean
      }
      schedule_json: {
        Args: { s: Database["public"]["Tables"]["exercise_schedules"]["Row"] }
        Returns: Json
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
      schedule_message: {
        Args: {
          p_id: string
          p_conversation: string
          p_body: string
          p_send_at: string
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
          p_attendance?: string
        }
        Returns: Json
      }
      scheduler_bulk_reject: {
        Args: { p_bookings: string[]; p_reason: string }
        Returns: number
      }
      scheduler_calendar_impact: {
        Args: { p_starts: string; p_ends: string; p_therapist?: string }
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
      scheduler_delete_time_off: {
        Args: { p_id: string }
        Returns: undefined
      }
      scheduler_log_export: {
        Args: { p_format: string; p_rows: number }
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
      scheduler_save_time_off: {
        Args: {
          p_id: string
          p_therapist: string
          p_starts: string
          p_ends: string
          p_reason: string
          p_resolutions?: Json
        }
        Returns: Json
      }
      scheduler_schedule_patients: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      scheduler_series_cancel: {
        Args: { p_series: string; p_reason: string }
        Returns: number
      }
      scheduler_series_create: {
        Args: {
          p_request: string
          p_patient: string
          p_therapist: string
          p_starts: string
          p_weeks: number
          p_reason?: string
        }
        Returns: Json
      }
      scheduler_series_preview: {
        Args: {
          p_patient: string
          p_therapist: string
          p_starts: string
          p_weeks: number
        }
        Returns: Json
      }
      scheduler_summary: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      scheduler_therapists: {
        Args: { p_booking?: string; p_starts?: string }
        Returns: Json
      }
      scheduler_time_off: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      send_attachment: {
        Args: { p_id: string; p_caption?: string }
        Returns: Json
      }
      send_message: {
        Args: { p_id: string; p_conversation: string; p_body: string }
        Returns: Json
      }
      send_scheduled_messages: {
        Args: { p_now?: string }
        Returns: number
      }
      series_check: {
        Args: {
          p_patient: string
          p_therapist: string
          p_starts: string
          p_weeks: number
        }
        Returns: undefined
      }
      series_dates: {
        Args: { p_starts: string; p_weeks: number }
        Returns: string[]
      }
      series_problem: {
        Args: {
          p_patient: string
          p_therapist: string
          p_starts: string
          p_ends: string
        }
        Returns: string
      }
      series_view: {
        Args: { p_series: string }
        Returns: Json
      }
      session_video_days: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      session_video_due: {
        Args: { p_limit?: number }
        Returns: string[]
      }
      session_video_json: {
        Args: { v: Database["public"]["Tables"]["session_videos"]["Row"] }
        Returns: Json
      }
      session_video_limit: {
        Args: { p_kind: string }
        Returns: number
      }
      session_video_ms: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      session_video_readable: {
        Args: { p_path: string }
        Returns: boolean
      }
      session_video_removed: {
        Args: { p_paths: string[] }
        Returns: number
      }
      session_video_usage: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      session_video_viewer: {
        Args: { v: Database["public"]["Tables"]["session_videos"]["Row"] }
        Returns: boolean
      }
      session_video_writable: {
        Args: { p_path: string }
        Returns: boolean
      }
      set_chat_consent: {
        Args: { p_granted: boolean }
        Returns: Json
      }
      set_conversation_muted: {
        Args: { p_conversation: string; p_muted: boolean }
        Returns: boolean
      }
      set_my_language: {
        Args: { p_language: string }
        Returns: undefined
      }
      set_my_profile_photo: {
        Args: { p_path: string }
        Returns: string
      }
      share_exercise: {
        Args: {
          p_id: string
          p_conversation: string
          p_assignment: string
          p_caption?: string
        }
        Returns: Json
      }
      share_progress: {
        Args: {
          p_id: string
          p_conversation: string
          p_progress: Json
          p_caption?: string
        }
        Returns: Json
      }
      share_session_video: {
        Args: { p_id: string }
        Returns: Json
      }
      signup_code_lifetime: {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
      skip_notification_delivery: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      skip_push_deliveries: {
        Args: { p_reason: string }
        Returns: number
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
      start_attachment: {
        Args: {
          p_id: string
          p_conversation: string
          p_kind: string
          p_mime: string
          p_width: number
          p_height: number
          p_duration_ms?: number
        }
        Returns: Json
      }
      start_profile_photo: {
        Args: { p_mime?: string }
        Returns: Json
      }
      start_session_video: {
        Args: {
          p_id: string
          p_session: string
          p_width: number
          p_height: number
          p_duration_ms: number
        }
        Returns: Json
      }
      stop_exercise: {
        Args: { p_assignment: string }
        Returns: undefined
      }
      stop_sharing_session_video: {
        Args: { p_id: string }
        Returns: undefined
      }
      therapist_schedule: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      unregister_device: {
        Args: { p_token: string }
        Returns: undefined
      }
      username_allowed: {
        Args: { value: string }
        Returns: boolean
      }
      visit_reason: {
        Args: { p_reason: string }
        Returns: string
      }
      waitlist_release: {
        Args: { p_from: string; p_to: string }
        Returns: undefined
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

