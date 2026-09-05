export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_context: { Args: { actor_user_id: string }; Returns: Json }
      account_profile: { Args: { actor_user_id: string }; Returns: Json }
      activate_partner_invitations: {
        Args: { actor_user_id: string; verified_email: string }
        Returns: number
      }
      advance_campaign_lifecycles: { Args: never; Returns: Json }
      agent_authorize_support_message: {
        Args: {
          agent_identity: string
          body_summary_value: string
          body_value: string
          candidate_campaign_id?: string
          candidate_donation_id?: string
          candidate_organization_id?: string
          complaint_or_threat?: boolean
          correlation_value?: string
          idempotency_value: string
          message_category: string
          recipient_email: string
          requests_access_change?: boolean
          requests_financial_action?: boolean
          requests_legal_or_tax_advice?: boolean
          security_or_privacy_incident?: boolean
          subject_value: string
        }
        Returns: Json
      }
      agent_authorize_support_message_payload: {
        Args: {
          agent_identity: string
          body_summary_value: string
          body_value: string
          candidate_campaign_id?: string
          candidate_donation_id?: string
          candidate_organization_id?: string
          complaint_or_threat?: boolean
          correlation_value?: string
          idempotency_value: string
          message_category: string
          recipient_email: string
          requests_access_change?: boolean
          requests_financial_action?: boolean
          requests_legal_or_tax_advice?: boolean
          security_or_privacy_incident?: boolean
          subject_value: string
        }
        Returns: Json
      }
      agent_contract_version: { Args: never; Returns: Json }
      agent_create_partner_lead: {
        Args: {
          agent_identity: string
          audience_summary_value?: string
          correlation_value?: string
          external_thread_value?: string
          goal_summary_value?: string
          idempotency_value: string
          organization_name_value: string
          request_summary_value: string
          requester_email: string
          timing_summary_value?: string
          website_url_value?: string
        }
        Returns: Json
      }
      agent_execute_article_command: {
        Args: {
          agent_identity: string
          command_value: string
          decision_id_value: string
          payload_value: Json
          target_id_value: string
        }
        Returns: Json
      }
      agent_execute_command: {
        Args: {
          agent_identity: string
          command_value: string
          decision_id_value: string
          payload_value: Json
          target_id_value: string
        }
        Returns: Json
      }
      agent_find_donations: {
        Args: {
          agent_identity: string
          public_id_hint?: string
          requester_email: string
          result_limit?: number
        }
        Returns: Json
      }
      agent_get_campaign_metrics: {
        Args: { candidate_campaign_id: string }
        Returns: Json
      }
      agent_get_donation_context: {
        Args: { candidate_public_id: string }
        Returns: Json
      }
      agent_get_donation_support_snapshot: {
        Args: {
          agent_identity: string
          candidate_donation_id: string
          requester_email: string
        }
        Returns: Json
      }
      agent_get_operations_overview: {
        Args: { agent_identity: string }
        Returns: Json
      }
      agent_get_partner_context: {
        Args: { candidate_organization_id: string }
        Returns: Json
      }
      agent_get_partner_support_snapshot: {
        Args: { agent_identity: string; requester_email: string }
        Returns: Json
      }
      agent_record_inbound_message: {
        Args: {
          agent_identity: string
          body_storage_value?: string
          body_summary_value: string
          candidate_campaign_id?: string
          candidate_donation_id?: string
          candidate_organization_id?: string
          external_message_value: string
          external_thread_value: string
          occurred_at_value?: string
          provider_value: string
          recipient_emails: Json
          sender_email: string
          subject_value: string
        }
        Returns: Json
      }
      agent_record_message_failure: {
        Args: {
          agent_identity: string
          authorization_value: string
          failure_code: string
        }
        Returns: Json
      }
      agent_record_outbound_message: {
        Args: {
          agent_identity: string
          authorization_value: string
          body_value: string
          content_hash_value: string
          external_message_value: string
          external_thread_value: string
          provider_value: string
          sender_identity_value: string
          sent_at_value?: string
          subject_value: string
        }
        Returns: Json
      }
      agent_record_outbound_message_checked: {
        Args: {
          agent_identity: string
          authorization_value: string
          body_value: string
          content_hash_value: string
          external_message_value: string
          external_thread_value: string
          provider_value: string
          recipient_email_value?: string
          sender_identity_value: string
          sent_at_value?: string
          subject_value: string
        }
        Returns: Json
      }
      agent_set_communication_thread_status: {
        Args: {
          agent_identity: string
          candidate_thread_id: string
          status_value: string
        }
        Returns: Json
      }
      agent_support_capabilities: {
        Args: { agent_identity: string }
        Returns: Json
      }
      application_contract_version: { Args: never; Returns: Json }
      claim_donation: {
        Args: {
          actor_user_id: string
          candidate_donation_id: string
          verified_email: string
        }
        Returns: Json
      }
      claim_outbox_events: {
        Args: { batch_size?: number; lease_seconds?: number; worker_id: string }
        Returns: {
          attempt_count: number
          domain_event_id: string
          event_type: string
          handler_key: string
          id: string
          locked_until: string
          max_attempts: number
          payload: Json
        }[]
      }
      complete_inline_outbox_event: {
        Args: { event_id: string; handler_name: string }
        Returns: boolean
      }
      complete_outbox_event: {
        Args: { event_id: string; worker_id: string }
        Returns: boolean
      }
      complete_pending_donation_claim: {
        Args: {
          actor_user_id: string
          pending_claim_value: string
          verified_email: string
        }
        Returns: Json
      }
      consume_anonymous_rate_limit: {
        Args: {
          action_value: string
          bucket_hash_value: string
          maximum_requests: number
          window_seconds: number
        }
        Returns: boolean
      }
      consume_auth_login_attempt: {
        Args: { state_hash_value: string }
        Returns: Json
      }
      create_auth_login_attempt: {
        Args: {
          destination_value: string
          expires_at_value: string
          pending_claim_value?: string
          state_hash_value: string
          storage_value: Json
        }
        Returns: undefined
      }
      create_donation: {
        Args: {
          campaign_slug?: string
          claim_nonce: string
          payload: Json
          request_hash_value: string
          tracking_nonce: string
        }
        Returns: Json
      }
      create_pending_donation_claim: {
        Args: { candidate_donation_id: string }
        Returns: string
      }
      donor_account_overview: { Args: { actor_user_id: string }; Returns: Json }
      donor_mark_donation_mailed: {
        Args: {
          actor_user_id: string
          candidate_donation_id: string
          carrier_name: string
          tracking_value: string
        }
        Returns: Json
      }
      evaluate_agent_command: {
        Args: {
          agent_identity: string
          command_value: string
          correlation_value: string
          facts: Json
          idempotency_value: string
          input_hash_value: string
          risk_value: Database["app_private"]["Enums"]["risk_level"]
          target_kind: string
          target_value: string
        }
        Returns: Json
      }
      fail_outbox_event: {
        Args: {
          error_code: string
          event_id: string
          retry_at: string
          retryable?: boolean
          worker_id: string
        }
        Returns: boolean
      }
      get_donation_charity: {
        Args: { candidate_donation_id: string }
        Returns: Json
      }
      get_donation_claim_material: {
        Args: { candidate_public_id: string }
        Returns: Json
      }
      get_donation_notification_event: {
        Args: { candidate_donation_id: string }
        Returns: Json
      }
      get_donation_notification_payload: {
        Args: { candidate_donation_id: string }
        Returns: Json
      }
      get_donation_status: {
        Args: { candidate_public_id: string }
        Returns: Json
      }
      get_donation_tracking_material: {
        Args: { candidate_public_id: string }
        Returns: Json
      }
      get_partner_application_notification: {
        Args: { candidate_application_id: string }
        Returns: Json
      }
      get_partner_invitation_email_payload: {
        Args: { candidate_invitation_id: string }
        Returns: Json
      }
      get_public_campaign: { Args: { campaign_slug: string }; Returns: Json }
      get_public_campaign_asset: {
        Args: { candidate_asset_id: string }
        Returns: Json
      }
      get_public_campaigns: { Args: never; Returns: Json }
      get_public_nonprofit: { Args: { profile_slug: string }; Returns: Json }
      get_public_nonprofit_asset: {
        Args: { candidate_asset_id: string }
        Returns: Json
      }
      get_public_nonprofits: { Args: never; Returns: Json }
      get_published_article: { Args: { candidate_slug: string }; Returns: Json }
      get_published_articles: { Args: never; Returns: Json }
      is_active_staff_email: {
        Args: { candidate_email: string }
        Returns: boolean
      }
      is_active_staff_user: {
        Args: { candidate_user_id: string }
        Returns: boolean
      }
      is_invited_partner_email: {
        Args: { candidate_email: string }
        Returns: boolean
      }
      is_reserved_route_slug: {
        Args: { candidate_slug: string }
        Returns: boolean
      }
      outbox_handler_receipt_exists: {
        Args: { p_event_id: string; p_handler_name: string }
        Returns: boolean
      }
      partner_campaign_asset: {
        Args: { actor_user_id: string; candidate_asset_id: string }
        Returns: Json
      }
      partner_campaign_detail: {
        Args: { actor_user_id: string; candidate_campaign_id: string }
        Returns: Json
      }
      partner_campaign_slug_available: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          candidate_slug: string
        }
        Returns: boolean
      }
      partner_campaign_workspace: {
        Args: { actor_user_id: string; candidate_campaign_id: string }
        Returns: Json
      }
      partner_create_campaign: {
        Args: {
          actor_user_id: string
          campaign_name: string
          campaign_slug: string
          candidate_charity_id: string
          candidate_organization_id: string
          content_hash_value: string
          cta_value: string
          headline_value: string
          story_value: string
          summary_value: string
        }
        Returns: Json
      }
      partner_create_campaign_asset: {
        Args: {
          actor_user_id: string
          alt_text_value: string
          asset_kind_value: string
          byte_size_value: number
          candidate_campaign_id: string
          content_sha256_value: string
          decorative_value: boolean
          mime_type_value: string
          storage_path_value: string
        }
        Returns: Json
      }
      partner_create_campaign_revision:
        | {
            Args: {
              actor_user_id: string
              candidate_campaign_id: string
              content_hash_value: string
              cta_value: string
              headline_value: string
              hero_asset_value: string
              story_value: string
              summary_value: string
            }
            Returns: Json
          }
        | {
            Args: {
              actor_user_id: string
              blocks_value?: Json
              candidate_campaign_id: string
              content_hash_value: string
              cta_value: string
              headline_value: string
              hero_asset_value: string
              story_value: string
              summary_value: string
              supporting_asset_value: string
            }
            Returns: Json
          }
      partner_create_campaign_v2: {
        Args: {
          actor_user_id: string
          blocks_value: Json
          campaign_name: string
          campaign_slug: string
          candidate_charity_id: string
          candidate_organization_id: string
          cta_value: string
          ends_at_value: string
          headline_value: string
          phone_goal_value: number
          starts_at_value: string
          story_value: string
          summary_value: string
          timezone_value: string
          toolkit_value: Json
        }
        Returns: Json
      }
      partner_delete_campaign_asset: {
        Args: { actor_user_id: string; candidate_asset_id: string }
        Returns: undefined
      }
      partner_delete_organization_asset: {
        Args: {
          actor_user_id: string
          candidate_asset_id: string
          candidate_organization_id: string
        }
        Returns: Json
      }
      partner_delete_unused_campaign_asset: {
        Args: {
          actor_user_id: string
          candidate_asset_id: string
          candidate_campaign_id: string
        }
        Returns: Json
      }
      partner_invite_member: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          email_value: string
          role_value: Database["app_private"]["Enums"]["organization_role"]
        }
        Returns: Json
      }
      partner_mark_campaign_ready: {
        Args: { actor_user_id: string; candidate_campaign_id: string }
        Returns: Json
      }
      partner_organization_asset: {
        Args: { actor_user_id: string; candidate_asset_id: string }
        Returns: Json
      }
      partner_overview: { Args: { actor_user_id: string }; Returns: Json }
      partner_profile_detail: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: Json
      }
      partner_register_campaign_asset: {
        Args: {
          actor_user_id: string
          alt_text_value: string
          asset_kind_value: string
          byte_size_value: number
          candidate_campaign_id: string
          content_sha256_value: string
          decorative_value: boolean
          height_value: number
          mime_type_value: string
          storage_path_value: string
          width_value: number
        }
        Returns: Json
      }
      partner_register_organization_asset: {
        Args: {
          actor_user_id: string
          alt_text_value: string
          asset_kind_value: string
          byte_size_value: number
          candidate_organization_id: string
          content_sha256_value: string
          decorative_value: boolean
          height_value: number
          mime_type_value: string
          storage_path_value: string
          width_value: number
        }
        Returns: Json
      }
      partner_restore_campaign_revision: {
        Args: {
          actor_user_id: string
          candidate_campaign_id: string
          candidate_revision_id: string
        }
        Returns: Json
      }
      partner_revoke_invitation: {
        Args: {
          actor_user_id: string
          candidate_invitation_id: string
          candidate_organization_id: string
        }
        Returns: boolean
      }
      partner_save_campaign_draft: {
        Args: {
          actor_user_id: string
          blocks_value: Json
          campaign_name_value: string
          candidate_campaign_id: string
          cta_value: string
          ends_at_value: string
          expected_lock_version: number
          headline_value: string
          hero_asset_value: string
          phone_goal_value: number
          stage_value: number
          starts_at_value: string
          story_value: string
          summary_value: string
          supporting_asset_value: string
          timezone_value: string
          toolkit_value: Json
        }
        Returns: Json
      }
      partner_save_profile_draft: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          country_value: string
          expected_lock_version: number
          hero_asset_value: string
          locality_value: string
          logo_asset_value: string
          mission_value: string
          region_value: string
          summary_value: string
          website_value: string
        }
        Returns: Json
      }
      partner_set_member_status: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          candidate_user_id: string
          status_value: Database["app_private"]["Enums"]["membership_status"]
        }
        Returns: boolean
      }
      partner_submit_campaign_review: {
        Args: { actor_user_id: string; candidate_campaign_id: string }
        Returns: Json
      }
      partner_submit_profile_review: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: Json
      }
      partner_workspace: { Args: { actor_user_id: string }; Returns: Json }
      prune_anonymous_rate_limits: {
        Args: { batch_size?: number }
        Returns: number
      }
      publish_due_articles: { Args: never; Returns: Json }
      record_campaign_event: {
        Args: {
          campaign_slug: string
          event_key_value: string
          event_type_value: string
          source_value?: string
        }
        Returns: boolean
      }
      record_outbox_handler_receipt: {
        Args: {
          p_event_id: string
          p_handler_name: string
          p_result_metadata?: Json
        }
        Returns: boolean
      }
      resolve_campaign_alias: {
        Args: { candidate_slug: string }
        Returns: Json
      }
      staff_add_internal_note: {
        Args: {
          actor_user_id: string
          candidate_donation_id: string
          note_body: string
        }
        Returns: Json
      }
      staff_add_unexpected_device: {
        Args: {
          actor_user_id: string
          actual_brand: string
          actual_model: string
          candidate_donation_id: string
        }
        Returns: Json
      }
      staff_associate_partner_charity: {
        Args: {
          actor_user_id: string
          candidate_charity_id: string
          candidate_organization_id: string
        }
        Returns: Json
      }
      staff_campaign_overview: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_campaign_revision_asset: {
        Args: { actor_user_id: string; candidate_asset_id: string }
        Returns: Json
      }
      staff_campaign_revision_preview: {
        Args: {
          actor_user_id: string
          candidate_campaign_id: string
          candidate_revision_id: string
        }
        Returns: Json
      }
      staff_change_donation_status: {
        Args: {
          actor_user_id: string
          candidate_donation_id: string
          new_status: Database["app_private"]["Enums"]["donation_status"]
          public_message?: string
        }
        Returns: Json
      }
      staff_create_partner_organization: {
        Args: { actor_user_id: string; name_value: string; slug_value: string }
        Returns: Json
      }
      staff_decide_disbursement: {
        Args: {
          actor_user_id: string
          candidate_preparation_id: string
          decision_value: Database["app_private"]["Enums"]["approval_outcome"]
          reason_value: string
        }
        Returns: Json
      }
      staff_finalize_donation_financials: {
        Args: { actor_user_id: string; candidate_donation_id: string }
        Returns: Json
      }
      staff_financial_overview: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_get_donation: {
        Args: { actor_user_id: string; candidate_donation_id: string }
        Returns: Json
      }
      staff_get_donation_financials: {
        Args: { actor_user_id: string; candidate_donation_id: string }
        Returns: Json
      }
      staff_invite_partner_admin: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          email_value: string
        }
        Returns: Json
      }
      staff_organization_profile_revision_asset: {
        Args: { actor_user_id: string; candidate_asset_id: string }
        Returns: Json
      }
      staff_partner_application_queue: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_partner_overview: { Args: { actor_user_id: string }; Returns: Json }
      staff_partner_review_queue: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_prepare_disbursement: {
        Args: {
          actor_user_id: string
          amount_value_cents: number
          candidate_allocation_id: string
          evidence_value: Json
          payment_memo_value: string
        }
        Returns: Json
      }
      staff_profile_revision_preview: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          candidate_revision_id: string
        }
        Returns: Json
      }
      staff_publish_campaign_revision: {
        Args: {
          actor_user_id: string
          candidate_campaign_id: string
          candidate_revision_id: string
        }
        Returns: Json
      }
      staff_publish_profile_revision: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          candidate_revision_id: string
        }
        Returns: Json
      }
      staff_record_cost: {
        Args: {
          actor_user_id: string
          candidate_device_id: string
          candidate_donation_id: string
          cost_amount_cents: number
          cost_category: string
          evidence_ref: string
          incurred_time: string
        }
        Returns: Json
      }
      staff_record_disbursement_completion: {
        Args: {
          actor_user_id: string
          candidate_preparation_id: string
          external_ref: string
        }
        Returns: Json
      }
      staff_record_receipt: {
        Args: {
          actor_user_id: string
          candidate_donation_id: string
          device_receipts: Json
          package_condition: string
          receipt_time: string
        }
        Returns: Json
      }
      staff_record_sale_and_allocation: {
        Args: {
          actor_user_id: string
          candidate_device_id: string
          external_ref: string
          gross_value_cents: number
          sale_channel: string
          sold_time: string
        }
        Returns: Json
      }
      staff_reopen_donation_financials: {
        Args: {
          actor_user_id: string
          candidate_donation_id: string
          reason_value: string
        }
        Returns: Json
      }
      staff_reverse_cost: {
        Args: {
          actor_user_id: string
          candidate_cost_id: string
          reason_value: string
        }
        Returns: Json
      }
      staff_reverse_sale: {
        Args: {
          actor_user_id: string
          candidate_sale_id: string
          reason_value: string
        }
        Returns: Json
      }
      staff_review_campaign_revision: {
        Args: {
          actor_user_id: string
          candidate_campaign_id: string
          candidate_revision_id: string
          feedback_value?: string
          outcome_value: Database["app_private"]["Enums"]["review_outcome"]
        }
        Returns: Json
      }
      staff_review_partner_application: {
        Args: {
          actor_user_id: string
          candidate_application_id: string
          candidate_organization_id?: string
          status_value: Database["app_private"]["Enums"]["partner_application_status"]
        }
        Returns: Json
      }
      staff_review_profile_revision: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          candidate_revision_id: string
          feedback_value?: string
          outcome_value: Database["app_private"]["Enums"]["review_outcome"]
        }
        Returns: Json
      }
      staff_search_donations: {
        Args: {
          actor_user_id: string
          result_limit?: number
          search_term?: string
        }
        Returns: Json
      }
      staff_session_context: { Args: { actor_user_id: string }; Returns: Json }
      staff_set_campaign_alias: {
        Args: {
          actor_user_id: string
          alias_slug_value: string
          behavior_value?: Database["app_private"]["Enums"]["campaign_alias_behavior"]
          candidate_campaign_id: string
        }
        Returns: Json
      }
      staff_set_partner_member_status: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          candidate_user_id: string
          status_value: Database["app_private"]["Enums"]["membership_status"]
        }
        Returns: Json
      }
      staff_set_partner_organization_status: {
        Args: {
          actor_user_id: string
          candidate_organization_id: string
          status_value: Database["app_private"]["Enums"]["organization_status"]
        }
        Returns: Json
      }
      staff_update_device: {
        Args: {
          actor_user_id: string
          candidate_device_id: string
          candidate_donation_id: string
          patch: Json
        }
        Returns: Json
      }
      staff_verify_partner_charity: {
        Args: {
          actor_user_id: string
          canonical_name_value: string
          ein_value?: string
          pledge_id_value: string
        }
        Returns: Json
      }
      submit_partner_application: {
        Args: {
          audience_value: string
          consent_value: boolean
          contact_name_value: string
          email_value: string
          goal_value: string
          idempotency_value: string
          organization_name_value: string
          role_title_value: string
          session_hash_value: string
          timing_value: string
          website_value: string
        }
        Returns: Json
      }
      update_account_profile: {
        Args: { actor_user_id: string; display_name_value: string }
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
  app_private: {
    Tables: {
      action_approvals: {
        Row: {
          action_decision_id: string
          approver_user_id: string
          created_at: string
          id: string
          outcome: Database["app_private"]["Enums"]["approval_outcome"]
          reason: string | null
        }
        Insert: {
          action_decision_id: string
          approver_user_id: string
          created_at?: string
          id?: string
          outcome: Database["app_private"]["Enums"]["approval_outcome"]
          reason?: string | null
        }
        Update: {
          action_decision_id?: string
          approver_user_id?: string
          created_at?: string
          id?: string
          outcome?: Database["app_private"]["Enums"]["approval_outcome"]
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_approvals_action_decision_id_fkey"
            columns: ["action_decision_id"]
            isOneToOne: false
            referencedRelation: "action_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_decisions: {
        Row: {
          actor: Database["app_private"]["Enums"]["actor_kind"]
          actor_ref: string
          command_name: string
          context: Json
          correlation_id: string
          decided_at: string
          execution_status: Database["app_private"]["Enums"]["action_execution_status"]
          id: string
          idempotency_key: string | null
          input_hash: string
          outcome: Database["app_private"]["Enums"]["action_policy_outcome"]
          policy_rule_id: string | null
          policy_version_id: string | null
          rationale_code: string
          risk: Database["app_private"]["Enums"]["risk_level"]
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          actor: Database["app_private"]["Enums"]["actor_kind"]
          actor_ref: string
          command_name: string
          context?: Json
          correlation_id: string
          decided_at?: string
          execution_status?: Database["app_private"]["Enums"]["action_execution_status"]
          id?: string
          idempotency_key?: string | null
          input_hash: string
          outcome: Database["app_private"]["Enums"]["action_policy_outcome"]
          policy_rule_id?: string | null
          policy_version_id?: string | null
          rationale_code: string
          risk: Database["app_private"]["Enums"]["risk_level"]
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          actor?: Database["app_private"]["Enums"]["actor_kind"]
          actor_ref?: string
          command_name?: string
          context?: Json
          correlation_id?: string
          decided_at?: string
          execution_status?: Database["app_private"]["Enums"]["action_execution_status"]
          id?: string
          idempotency_key?: string | null
          input_hash?: string
          outcome?: Database["app_private"]["Enums"]["action_policy_outcome"]
          policy_rule_id?: string | null
          policy_version_id?: string | null
          rationale_code?: string
          risk?: Database["app_private"]["Enums"]["risk_level"]
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_decisions_policy_rule_id_fkey"
            columns: ["policy_rule_id"]
            isOneToOne: false
            referencedRelation: "action_policy_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_decisions_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "action_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_execution_results: {
        Row: {
          action_decision_id: string
          created_at: string
          executor: Database["app_private"]["Enums"]["actor_kind"]
          executor_ref: string
          id: string
          result_metadata: Json
          status: Database["app_private"]["Enums"]["action_execution_status"]
          verification_metadata: Json
        }
        Insert: {
          action_decision_id: string
          created_at?: string
          executor: Database["app_private"]["Enums"]["actor_kind"]
          executor_ref: string
          id?: string
          result_metadata?: Json
          status: Database["app_private"]["Enums"]["action_execution_status"]
          verification_metadata?: Json
        }
        Update: {
          action_decision_id?: string
          created_at?: string
          executor?: Database["app_private"]["Enums"]["actor_kind"]
          executor_ref?: string
          id?: string
          result_metadata?: Json
          status?: Database["app_private"]["Enums"]["action_execution_status"]
          verification_metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "action_execution_results_action_decision_id_fkey"
            columns: ["action_decision_id"]
            isOneToOne: false
            referencedRelation: "action_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_policy_rules: {
        Row: {
          actor: Database["app_private"]["Enums"]["actor_kind"] | null
          command_name: string
          conditions: Json
          created_at: string
          id: string
          outcome: Database["app_private"]["Enums"]["action_policy_outcome"]
          policy_version_id: string
          priority: number
          rationale_code: string
          risk_levels: Database["app_private"]["Enums"]["risk_level"][]
          target_type: string | null
        }
        Insert: {
          actor?: Database["app_private"]["Enums"]["actor_kind"] | null
          command_name: string
          conditions?: Json
          created_at?: string
          id?: string
          outcome: Database["app_private"]["Enums"]["action_policy_outcome"]
          policy_version_id: string
          priority?: number
          rationale_code: string
          risk_levels: Database["app_private"]["Enums"]["risk_level"][]
          target_type?: string | null
        }
        Update: {
          actor?: Database["app_private"]["Enums"]["actor_kind"] | null
          command_name?: string
          conditions?: Json
          created_at?: string
          id?: string
          outcome?: Database["app_private"]["Enums"]["action_policy_outcome"]
          policy_version_id?: string
          priority?: number
          rationale_code?: string
          risk_levels?: Database["app_private"]["Enums"]["risk_level"][]
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_policy_rules_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "action_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_policy_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          lifecycle: Database["app_private"]["Enums"]["policy_lifecycle"]
          policy_key: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          policy_key: string
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          policy_key?: string
          version?: number
        }
        Relationships: []
      }
      agent_actions: {
        Row: {
          action_decision_id: string
          agent_ref: string
          created_at: string
          id: string
          invocation_metadata: Json
          status: Database["app_private"]["Enums"]["agent_action_status"]
          updated_at: string
        }
        Insert: {
          action_decision_id: string
          agent_ref: string
          created_at?: string
          id?: string
          invocation_metadata?: Json
          status?: Database["app_private"]["Enums"]["agent_action_status"]
          updated_at?: string
        }
        Update: {
          action_decision_id?: string
          agent_ref?: string
          created_at?: string
          id?: string
          invocation_metadata?: Json
          status?: Database["app_private"]["Enums"]["agent_action_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_action_decision_id_fkey"
            columns: ["action_decision_id"]
            isOneToOne: true
            referencedRelation: "action_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_escalations: {
        Row: {
          agent_action_id: string
          assigned_to: string | null
          created_at: string
          id: string
          reason_code: string
          resolved_at: string | null
          severity: Database["app_private"]["Enums"]["risk_level"]
          status: Database["app_private"]["Enums"]["escalation_status"]
          summary: string
        }
        Insert: {
          agent_action_id: string
          assigned_to?: string | null
          created_at?: string
          id?: string
          reason_code: string
          resolved_at?: string | null
          severity: Database["app_private"]["Enums"]["risk_level"]
          status?: Database["app_private"]["Enums"]["escalation_status"]
          summary: string
        }
        Update: {
          agent_action_id?: string
          assigned_to?: string | null
          created_at?: string
          id?: string
          reason_code?: string
          resolved_at?: string | null
          severity?: Database["app_private"]["Enums"]["risk_level"]
          status?: Database["app_private"]["Enums"]["escalation_status"]
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_escalations_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_message_authorizations: {
        Row: {
          action_decision_id: string
          agent_action_id: string
          agent_ref: string
          body_summary: string
          campaign_id: string | null
          consumed_at: string | null
          content_hash: string
          created_at: string
          donation_id: string | null
          expires_at: string
          id: string
          identity_verified: boolean
          message_category: string
          organization_id: string | null
          outcome: Database["app_private"]["Enums"]["action_policy_outcome"]
          recipient_email_search: string
          risk: Database["app_private"]["Enums"]["risk_level"]
          subject: string
        }
        Insert: {
          action_decision_id: string
          agent_action_id: string
          agent_ref: string
          body_summary: string
          campaign_id?: string | null
          consumed_at?: string | null
          content_hash: string
          created_at?: string
          donation_id?: string | null
          expires_at: string
          id?: string
          identity_verified?: boolean
          message_category: string
          organization_id?: string | null
          outcome: Database["app_private"]["Enums"]["action_policy_outcome"]
          recipient_email_search: string
          risk: Database["app_private"]["Enums"]["risk_level"]
          subject: string
        }
        Update: {
          action_decision_id?: string
          agent_action_id?: string
          agent_ref?: string
          body_summary?: string
          campaign_id?: string | null
          consumed_at?: string | null
          content_hash?: string
          created_at?: string
          donation_id?: string | null
          expires_at?: string
          id?: string
          identity_verified?: boolean
          message_category?: string
          organization_id?: string | null
          outcome?: Database["app_private"]["Enums"]["action_policy_outcome"]
          recipient_email_search?: string
          risk?: Database["app_private"]["Enums"]["risk_level"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_message_authorizations_action_decision_id_fkey"
            columns: ["action_decision_id"]
            isOneToOne: true
            referencedRelation: "action_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_message_authorizations_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: true
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_message_authorizations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_message_authorizations_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_message_authorizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_state_events: {
        Row: {
          actor_user_id: string
          allocation_id: string
          id: string
          occurred_at: string
          reason_code: string
          status: Database["app_private"]["Enums"]["allocation_status"]
        }
        Insert: {
          actor_user_id: string
          allocation_id: string
          id?: string
          occurred_at?: string
          reason_code: string
          status: Database["app_private"]["Enums"]["allocation_status"]
        }
        Update: {
          actor_user_id?: string
          allocation_id?: string
          id?: string
          occurred_at?: string
          reason_code?: string
          status?: Database["app_private"]["Enums"]["allocation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "allocation_state_events_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "effective_proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_state_events_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "proceeds_allocations"
            referencedColumns: ["id"]
          },
        ]
      }
      anonymous_rate_limits: {
        Row: {
          action_name: string
          bucket_hash: string
          request_count: number
          window_started_at: string
        }
        Insert: {
          action_name: string
          bucket_hash: string
          request_count: number
          window_started_at: string
        }
        Update: {
          action_name?: string
          bucket_hash?: string
          request_count?: number
          window_started_at?: string
        }
        Relationships: []
      }
      article_revisions: {
        Row: {
          article_id: string
          author_name: string
          content_blocks: Json
          content_hash: string
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          excerpt: string
          id: string
          seo_description: string | null
          seo_title: string | null
          title: string
          version: number
        }
        Insert: {
          article_id: string
          author_name?: string
          content_blocks: Json
          content_hash: string
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          excerpt: string
          id?: string
          seo_description?: string | null
          seo_title?: string | null
          title: string
          version: number
        }
        Update: {
          article_id?: string
          author_name?: string
          content_blocks?: Json
          content_hash?: string
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          excerpt?: string
          id?: string
          seo_description?: string | null
          seo_title?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "article_revisions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          current_revision_id: string | null
          id: string
          published_revision_id: string | null
          scheduled_publish_at: string | null
          scheduled_revision_id: string | null
          slug: string
          status: Database["app_private"]["Enums"]["article_status"]
          updated_at: string
          updated_by: string | null
          updated_by_agent: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          current_revision_id?: string | null
          id?: string
          published_revision_id?: string | null
          scheduled_publish_at?: string | null
          scheduled_revision_id?: string | null
          slug: string
          status?: Database["app_private"]["Enums"]["article_status"]
          updated_at?: string
          updated_by?: string | null
          updated_by_agent?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          current_revision_id?: string | null
          id?: string
          published_revision_id?: string | null
          scheduled_publish_at?: string | null
          scheduled_revision_id?: string | null
          slug?: string
          status?: Database["app_private"]["Enums"]["article_status"]
          updated_at?: string
          updated_by?: string | null
          updated_by_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_current_revision_fk"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "article_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_published_revision_fk"
            columns: ["published_revision_id"]
            isOneToOne: false
            referencedRelation: "article_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_scheduled_revision_fk"
            columns: ["scheduled_revision_id"]
            isOneToOne: false
            referencedRelation: "article_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action_name: string
          actor: Database["app_private"]["Enums"]["actor_kind"]
          actor_ref: string
          correlation_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          occurred_at: string
          reason_code: string | null
          redacted_changes: Json
          request_id: string | null
        }
        Insert: {
          action_name: string
          actor: Database["app_private"]["Enums"]["actor_kind"]
          actor_ref: string
          correlation_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          reason_code?: string | null
          redacted_changes?: Json
          request_id?: string | null
        }
        Update: {
          action_name?: string
          actor?: Database["app_private"]["Enums"]["actor_kind"]
          actor_ref?: string
          correlation_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          reason_code?: string | null
          redacted_changes?: Json
          request_id?: string | null
        }
        Relationships: []
      }
      auth_login_attempts: {
        Row: {
          consumed_at: string | null
          created_at: string
          destination: string
          expires_at: string
          pending_claim_id: string | null
          pkce_storage: Json
          state_hash: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          destination: string
          expires_at: string
          pending_claim_id?: string | null
          pkce_storage: Json
          state_hash: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          destination?: string
          expires_at?: string
          pending_claim_id?: string | null
          pkce_storage?: Json
          state_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_login_attempts_pending_claim_id_fkey"
            columns: ["pending_claim_id"]
            isOneToOne: false
            referencedRelation: "pending_donation_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_assets: {
        Row: {
          alt_text: string
          asset_kind: string
          byte_size: number
          campaign_id: string
          content_sha256: string | null
          created_at: string
          height_pixels: number | null
          id: string
          is_decorative: boolean
          metadata_scrubbed: boolean
          mime_type: string
          storage_format_version: number
          storage_path: string
          uploaded_by: string
          width_pixels: number | null
        }
        Insert: {
          alt_text: string
          asset_kind: string
          byte_size: number
          campaign_id: string
          content_sha256?: string | null
          created_at?: string
          height_pixels?: number | null
          id?: string
          is_decorative?: boolean
          metadata_scrubbed?: boolean
          mime_type: string
          storage_format_version?: number
          storage_path: string
          uploaded_by: string
          width_pixels?: number | null
        }
        Update: {
          alt_text?: string
          asset_kind?: string
          byte_size?: number
          campaign_id?: string
          content_sha256?: string | null
          created_at?: string
          height_pixels?: number | null
          id?: string
          is_decorative?: boolean
          metadata_scrubbed?: boolean
          mime_type?: string
          storage_format_version?: number
          storage_path?: string
          uploaded_by?: string
          width_pixels?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          anonymous_session_hash: string | null
          campaign_id: string
          event_key: string | null
          event_type: string
          id: string
          occurred_at: string
          source_category: string | null
        }
        Insert: {
          anonymous_session_hash?: string | null
          campaign_id: string
          event_key?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          source_category?: string | null
        }
        Update: {
          anonymous_session_hash?: string | null
          campaign_id?: string
          event_key?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          source_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_reviews: {
        Row: {
          actor_kind: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id: string | null
          campaign_id: string
          created_at: string
          feedback: string | null
          id: string
          outcome: Database["app_private"]["Enums"]["review_outcome"]
          revision_id: string
        }
        Insert: {
          actor_kind: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id?: string | null
          campaign_id: string
          created_at?: string
          feedback?: string | null
          id?: string
          outcome: Database["app_private"]["Enums"]["review_outcome"]
          revision_id: string
        }
        Update: {
          actor_kind?: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id?: string | null
          campaign_id?: string
          created_at?: string
          feedback?: string | null
          id?: string
          outcome?: Database["app_private"]["Enums"]["review_outcome"]
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_reviews_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_reviews_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "campaign_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_revision_blocks: {
        Row: {
          block_order: number
          block_type: string
          content: Json
          created_at: string
          id: string
          revision_id: string
        }
        Insert: {
          block_order: number
          block_type: string
          content: Json
          created_at?: string
          id?: string
          revision_id: string
        }
        Update: {
          block_order?: number
          block_type?: string
          content?: Json
          created_at?: string
          id?: string
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_revision_blocks_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "campaign_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_revisions: {
        Row: {
          approved_by: string | null
          campaign_id: string
          content_blocks: Json
          content_hash: string
          created_at: string
          cta_label: string
          ends_at: string | null
          headline: string
          hero_asset_id: string | null
          hero_asset_sha256: string | null
          hero_image_url: string | null
          id: string
          phone_goal: number | null
          published_at: string | null
          published_by: string | null
          requested_by: string | null
          requested_by_agent: string | null
          starts_at: string | null
          status: Database["app_private"]["Enums"]["campaign_revision_status"]
          story: string
          summary: string
          supporting_asset_id: string | null
          supporting_asset_sha256: string | null
          timezone: string
          toolkit: Json
          version: number
        }
        Insert: {
          approved_by?: string | null
          campaign_id: string
          content_blocks?: Json
          content_hash: string
          created_at?: string
          cta_label?: string
          ends_at?: string | null
          headline: string
          hero_asset_id?: string | null
          hero_asset_sha256?: string | null
          hero_image_url?: string | null
          id?: string
          phone_goal?: number | null
          published_at?: string | null
          published_by?: string | null
          requested_by?: string | null
          requested_by_agent?: string | null
          starts_at?: string | null
          status?: Database["app_private"]["Enums"]["campaign_revision_status"]
          story: string
          summary: string
          supporting_asset_id?: string | null
          supporting_asset_sha256?: string | null
          timezone?: string
          toolkit?: Json
          version: number
        }
        Update: {
          approved_by?: string | null
          campaign_id?: string
          content_blocks?: Json
          content_hash?: string
          created_at?: string
          cta_label?: string
          ends_at?: string | null
          headline?: string
          hero_asset_id?: string | null
          hero_asset_sha256?: string | null
          hero_image_url?: string | null
          id?: string
          phone_goal?: number | null
          published_at?: string | null
          published_by?: string | null
          requested_by?: string | null
          requested_by_agent?: string | null
          starts_at?: string | null
          status?: Database["app_private"]["Enums"]["campaign_revision_status"]
          story?: string
          summary?: string
          supporting_asset_id?: string | null
          supporting_asset_sha256?: string | null
          timezone?: string
          toolkit?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_revisions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_revisions_hero_asset_id_fkey"
            columns: ["hero_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_revisions_supporting_asset_id_fkey"
            columns: ["supporting_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_route_aliases: {
        Row: {
          behavior: Database["app_private"]["Enums"]["campaign_alias_behavior"]
          campaign_id: string
          canonical_slug: string
          created_at: string
          created_by: string | null
          id: string
          retired_at: string | null
          retired_by: string | null
          root_slug: string
          status: Database["app_private"]["Enums"]["campaign_alias_status"]
        }
        Insert: {
          behavior?: Database["app_private"]["Enums"]["campaign_alias_behavior"]
          campaign_id: string
          canonical_slug: string
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          retired_by?: string | null
          root_slug: string
          status?: Database["app_private"]["Enums"]["campaign_alias_status"]
        }
        Update: {
          behavior?: Database["app_private"]["Enums"]["campaign_alias_behavior"]
          campaign_id?: string
          canonical_slug?: string
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          retired_by?: string | null
          root_slug?: string
          status?: Database["app_private"]["Enums"]["campaign_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "campaign_route_aliases_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_working_drafts: {
        Row: {
          campaign_id: string
          content_blocks: Json
          cta_label: string
          ends_at: string | null
          headline: string
          hero_asset_id: string | null
          lock_version: number
          partner_ready: boolean
          phone_goal: number | null
          review_feedback: string | null
          review_state: string
          stage: number
          starts_at: string | null
          story: string
          summary: string
          supporting_asset_id: string | null
          timezone: string
          toolkit: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id: string
          content_blocks?: Json
          cta_label?: string
          ends_at?: string | null
          headline?: string
          hero_asset_id?: string | null
          lock_version?: number
          partner_ready?: boolean
          phone_goal?: number | null
          review_feedback?: string | null
          review_state?: string
          stage?: number
          starts_at?: string | null
          story?: string
          summary?: string
          supporting_asset_id?: string | null
          timezone?: string
          toolkit?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string
          content_blocks?: Json
          cta_label?: string
          ends_at?: string | null
          headline?: string
          hero_asset_id?: string | null
          lock_version?: number
          partner_ready?: boolean
          phone_goal?: number | null
          review_feedback?: string | null
          review_state?: string
          stage?: number
          starts_at?: string | null
          story?: string
          summary?: string
          supporting_asset_id?: string | null
          timezone?: string
          toolkit?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_working_drafts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_working_drafts_hero_asset_id_fkey"
            columns: ["hero_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_working_drafts_supporting_asset_id_fkey"
            columns: ["supporting_asset_id"]
            isOneToOne: false
            referencedRelation: "campaign_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active_revision_id: string | null
          charity_id: string
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          name: string
          organization_id: string
          phone_goal: number | null
          review_feedback: string | null
          selected_charity_name: string
          selected_charity_pledge_id: string
          slug: string
          starts_at: string | null
          status: Database["app_private"]["Enums"]["campaign_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          active_revision_id?: string | null
          charity_id: string
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          name: string
          organization_id: string
          phone_goal?: number | null
          review_feedback?: string | null
          selected_charity_name: string
          selected_charity_pledge_id: string
          slug: string
          starts_at?: string | null
          status?: Database["app_private"]["Enums"]["campaign_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          active_revision_id?: string | null
          charity_id?: string
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone_goal?: number | null
          review_feedback?: string | null
          selected_charity_name?: string
          selected_charity_pledge_id?: string
          slug?: string
          starts_at?: string | null
          status?: Database["app_private"]["Enums"]["campaign_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_active_revision_fk"
            columns: ["active_revision_id"]
            isOneToOne: false
            referencedRelation: "campaign_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_charity_id_fkey"
            columns: ["charity_id"]
            isOneToOne: false
            referencedRelation: "charities"
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
      charities: {
        Row: {
          canonical_name: string
          created_at: string
          ein: string | null
          id: string
          pledge_id: string
          status: Database["app_private"]["Enums"]["charity_verification_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          canonical_name: string
          created_at?: string
          ein?: string | null
          id?: string
          pledge_id: string
          status?: Database["app_private"]["Enums"]["charity_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          canonical_name?: string
          created_at?: string
          ein?: string | null
          id?: string
          pledge_id?: string
          status?: Database["app_private"]["Enums"]["charity_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      communication_messages: {
        Row: {
          agent_action_id: string | null
          body_storage_ref: string | null
          body_summary: string | null
          created_at: string
          direction: string
          external_message_ref: string | null
          id: string
          recipient_identity_refs: Json
          sender_identity_ref: string | null
          sent_at: string | null
          thread_id: string
        }
        Insert: {
          agent_action_id?: string | null
          body_storage_ref?: string | null
          body_summary?: string | null
          created_at?: string
          direction: string
          external_message_ref?: string | null
          id?: string
          recipient_identity_refs?: Json
          sender_identity_ref?: string | null
          sent_at?: string | null
          thread_id: string
        }
        Update: {
          agent_action_id?: string | null
          body_storage_ref?: string | null
          body_summary?: string | null
          created_at?: string
          direction?: string
          external_message_ref?: string | null
          id?: string
          recipient_identity_refs?: Json
          sender_identity_ref?: string | null
          sent_at?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_messages_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "communication_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_threads: {
        Row: {
          campaign_id: string | null
          contact_email_search: string | null
          created_at: string
          donation_id: string | null
          external_provider: string
          external_thread_ref: string | null
          id: string
          inbound_verified: boolean
          last_message_at: string | null
          organization_id: string | null
          status: string
          subject: string | null
        }
        Insert: {
          campaign_id?: string | null
          contact_email_search?: string | null
          created_at?: string
          donation_id?: string | null
          external_provider: string
          external_thread_ref?: string | null
          id?: string
          inbound_verified?: boolean
          last_message_at?: string | null
          organization_id?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          campaign_id?: string | null
          contact_email_search?: string | null
          created_at?: string
          donation_id?: string | null
          external_provider?: string
          external_thread_ref?: string | null
          id?: string
          inbound_verified?: boolean
          last_message_at?: string | null
          organization_id?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_threads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_threads_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_allocation_applications: {
        Row: {
          applied_cents: number
          calculation_snapshot: Json
          cost_id: string
          created_at: string
          device_id: string
          id: string
          policy_rule_id: string
          sale_result_id: string
        }
        Insert: {
          applied_cents: number
          calculation_snapshot: Json
          cost_id: string
          created_at?: string
          device_id: string
          id?: string
          policy_rule_id: string
          sale_result_id: string
        }
        Update: {
          applied_cents?: number
          calculation_snapshot?: Json
          cost_id?: string
          created_at?: string
          device_id?: string
          id?: string
          policy_rule_id?: string
          sale_result_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_allocation_applications_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "donation_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocation_applications_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "effective_donation_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocation_applications_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "donation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocation_applications_policy_rule_id_fkey"
            columns: ["policy_rule_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_cost_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocation_applications_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "device_sale_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_allocation_applications_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "effective_device_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sale_results: {
        Row: {
          channel: string
          created_at: string
          currency: string
          device_id: string
          external_reference: string | null
          gross_amount_cents: number
          id: string
          recorded_by: string
          reversal_of: string | null
          sold_at: string
          status: Database["app_private"]["Enums"]["financial_entry_status"]
        }
        Insert: {
          channel: string
          created_at?: string
          currency?: string
          device_id: string
          external_reference?: string | null
          gross_amount_cents: number
          id?: string
          recorded_by: string
          reversal_of?: string | null
          sold_at: string
          status?: Database["app_private"]["Enums"]["financial_entry_status"]
        }
        Update: {
          channel?: string
          created_at?: string
          currency?: string
          device_id?: string
          external_reference?: string | null
          gross_amount_cents?: number
          id?: string
          recorded_by?: string
          reversal_of?: string | null
          sold_at?: string
          status?: Database["app_private"]["Enums"]["financial_entry_status"]
        }
        Relationships: [
          {
            foreignKeyName: "device_sale_results_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "donation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sale_results_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "device_sale_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sale_results_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "effective_device_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      disbursement_approvals: {
        Row: {
          approval_policy_id: string
          approver_user_id: string
          created_at: string
          id: string
          outcome: Database["app_private"]["Enums"]["approval_outcome"]
          preparation_id: string
          reason: string | null
        }
        Insert: {
          approval_policy_id: string
          approver_user_id: string
          created_at?: string
          id?: string
          outcome: Database["app_private"]["Enums"]["approval_outcome"]
          preparation_id: string
          reason?: string | null
        }
        Update: {
          approval_policy_id?: string
          approver_user_id?: string
          created_at?: string
          id?: string
          outcome?: Database["app_private"]["Enums"]["approval_outcome"]
          preparation_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disbursement_approvals_approval_policy_id_fkey"
            columns: ["approval_policy_id"]
            isOneToOne: false
            referencedRelation: "financial_approval_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursement_approvals_preparation_id_fkey"
            columns: ["preparation_id"]
            isOneToOne: false
            referencedRelation: "disbursement_preparations"
            referencedColumns: ["id"]
          },
        ]
      }
      disbursement_preparation_allocations: {
        Row: {
          allocation_id: string
          amount_cents: number
          preparation_id: string
        }
        Insert: {
          allocation_id: string
          amount_cents: number
          preparation_id: string
        }
        Update: {
          allocation_id?: string
          amount_cents?: number
          preparation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disbursement_preparation_allocations_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "effective_proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursement_preparation_allocations_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursement_preparation_allocations_preparation_id_fkey"
            columns: ["preparation_id"]
            isOneToOne: false
            referencedRelation: "disbursement_preparations"
            referencedColumns: ["id"]
          },
        ]
      }
      disbursement_preparations: {
        Row: {
          amount_cents: number
          approval_policy_id: string | null
          approval_preparer_may_approve: boolean | null
          approval_required_count: number | null
          beneficiary_charity_id: string | null
          beneficiary_pledge_id: string | null
          beneficiary_reference: string
          campaign_id: string | null
          currency: string
          evidence: Json
          id: string
          organization_id: string | null
          payment_memo: string | null
          prepared_at: string
          prepared_by: string
        }
        Insert: {
          amount_cents: number
          approval_policy_id?: string | null
          approval_preparer_may_approve?: boolean | null
          approval_required_count?: number | null
          beneficiary_charity_id?: string | null
          beneficiary_pledge_id?: string | null
          beneficiary_reference: string
          campaign_id?: string | null
          currency?: string
          evidence?: Json
          id?: string
          organization_id?: string | null
          payment_memo?: string | null
          prepared_at?: string
          prepared_by: string
        }
        Update: {
          amount_cents?: number
          approval_policy_id?: string | null
          approval_preparer_may_approve?: boolean | null
          approval_required_count?: number | null
          beneficiary_charity_id?: string | null
          beneficiary_pledge_id?: string | null
          beneficiary_reference?: string
          campaign_id?: string | null
          currency?: string
          evidence?: Json
          id?: string
          organization_id?: string | null
          payment_memo?: string | null
          prepared_at?: string
          prepared_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "disbursement_preparations_approval_policy_id_fkey"
            columns: ["approval_policy_id"]
            isOneToOne: false
            referencedRelation: "financial_approval_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursement_preparations_beneficiary_charity_id_fkey"
            columns: ["beneficiary_charity_id"]
            isOneToOne: false
            referencedRelation: "charities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursement_preparations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursement_preparations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disbursements: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          external_payment_reference: string | null
          id: string
          preparation_id: string
          reversal_of: string | null
          status: Database["app_private"]["Enums"]["disbursement_status"]
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          external_payment_reference?: string | null
          id?: string
          preparation_id: string
          reversal_of?: string | null
          status?: Database["app_private"]["Enums"]["disbursement_status"]
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          external_payment_reference?: string | null
          id?: string
          preparation_id?: string
          reversal_of?: string | null
          status?: Database["app_private"]["Enums"]["disbursement_status"]
        }
        Relationships: [
          {
            foreignKeyName: "disbursements_preparation_id_fkey"
            columns: ["preparation_id"]
            isOneToOne: true
            referencedRelation: "disbursement_preparations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursements_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "disbursements"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number
          causation_id: string | null
          correlation_id: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number
          causation_id?: string | null
          correlation_id?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          aggregate_version?: number
          causation_id?: string | null
          correlation_id?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: []
      }
      donation_claim_capabilities: {
        Row: {
          claimed_by: string | null
          consumed_at: string | null
          created_at: string
          donation_id: string
          expires_at: string
        }
        Insert: {
          claimed_by?: string | null
          consumed_at?: string | null
          created_at?: string
          donation_id: string
          expires_at: string
        }
        Update: {
          claimed_by?: string | null
          consumed_at?: string | null
          created_at?: string
          donation_id?: string
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_claim_capabilities_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: true
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_costs: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          currency: string
          device_id: string | null
          donation_id: string
          evidence_reference: string | null
          id: string
          incurred_at: string
          recorded_by: string
          reversal_of: string | null
          status: Database["app_private"]["Enums"]["financial_entry_status"]
        }
        Insert: {
          amount_cents: number
          category: string
          created_at?: string
          currency?: string
          device_id?: string | null
          donation_id: string
          evidence_reference?: string | null
          id?: string
          incurred_at: string
          recorded_by: string
          reversal_of?: string | null
          status?: Database["app_private"]["Enums"]["financial_entry_status"]
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          currency?: string
          device_id?: string | null
          donation_id?: string
          evidence_reference?: string | null
          id?: string
          incurred_at?: string
          recorded_by?: string
          reversal_of?: string | null
          status?: Database["app_private"]["Enums"]["financial_entry_status"]
        }
        Relationships: [
          {
            foreignKeyName: "donation_costs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "donation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_costs_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_costs_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "donation_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_costs_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "effective_donation_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_devices: {
        Row: {
          actual_brand: string | null
          actual_model: string | null
          assessed_value_cents: number | null
          created_at: string
          data_wipe_status: Database["app_private"]["Enums"]["data_wipe_status"]
          donation_id: string
          donor_age: string | null
          donor_brand: string | null
          donor_condition: string | null
          donor_device_key: string | null
          donor_model: string | null
          donor_powers_on: boolean | null
          donor_storage: string | null
          donor_unlocked: boolean | null
          id: string
          inspected_at: string | null
          inspected_by: string | null
          inspection_status: Database["app_private"]["Enums"]["device_inspection_status"]
          processing_status: Database["app_private"]["Enums"]["device_processing_status"]
          receipt_status: Database["app_private"]["Enums"]["device_receipt_status"]
          received_at: string | null
          serial_last_four: string | null
          source: Database["app_private"]["Enums"]["device_source"]
          updated_at: string
          valued_at: string | null
          valued_by: string | null
          wipe_verified_at: string | null
          wipe_verified_by: string | null
        }
        Insert: {
          actual_brand?: string | null
          actual_model?: string | null
          assessed_value_cents?: number | null
          created_at?: string
          data_wipe_status?: Database["app_private"]["Enums"]["data_wipe_status"]
          donation_id: string
          donor_age?: string | null
          donor_brand?: string | null
          donor_condition?: string | null
          donor_device_key?: string | null
          donor_model?: string | null
          donor_powers_on?: boolean | null
          donor_storage?: string | null
          donor_unlocked?: boolean | null
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          inspection_status?: Database["app_private"]["Enums"]["device_inspection_status"]
          processing_status?: Database["app_private"]["Enums"]["device_processing_status"]
          receipt_status?: Database["app_private"]["Enums"]["device_receipt_status"]
          received_at?: string | null
          serial_last_four?: string | null
          source?: Database["app_private"]["Enums"]["device_source"]
          updated_at?: string
          valued_at?: string | null
          valued_by?: string | null
          wipe_verified_at?: string | null
          wipe_verified_by?: string | null
        }
        Update: {
          actual_brand?: string | null
          actual_model?: string | null
          assessed_value_cents?: number | null
          created_at?: string
          data_wipe_status?: Database["app_private"]["Enums"]["data_wipe_status"]
          donation_id?: string
          donor_age?: string | null
          donor_brand?: string | null
          donor_condition?: string | null
          donor_device_key?: string | null
          donor_model?: string | null
          donor_powers_on?: boolean | null
          donor_storage?: string | null
          donor_unlocked?: boolean | null
          id?: string
          inspected_at?: string | null
          inspected_by?: string | null
          inspection_status?: Database["app_private"]["Enums"]["device_inspection_status"]
          processing_status?: Database["app_private"]["Enums"]["device_processing_status"]
          receipt_status?: Database["app_private"]["Enums"]["device_receipt_status"]
          received_at?: string | null
          serial_last_four?: string | null
          source?: Database["app_private"]["Enums"]["device_source"]
          updated_at?: string
          valued_at?: string | null
          valued_by?: string | null
          wipe_verified_at?: string | null
          wipe_verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donation_devices_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_internal_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          created_by_agent: string | null
          donation_id: string
          id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          donation_id: string
          id?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          created_by_agent?: string | null
          donation_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_internal_notes_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_shipments: {
        Row: {
          carrier: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          direction: Database["app_private"]["Enums"]["shipment_direction"]
          donation_id: string
          id: string
          mailed_at: string | null
          status: Database["app_private"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction?: Database["app_private"]["Enums"]["shipment_direction"]
          donation_id: string
          id?: string
          mailed_at?: string | null
          status?: Database["app_private"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction?: Database["app_private"]["Enums"]["shipment_direction"]
          donation_id?: string
          id?: string
          mailed_at?: string | null
          status?: Database["app_private"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_shipments_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      donation_status_events: {
        Row: {
          actor: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id: string | null
          donation_id: string
          donor_visible: boolean
          id: string
          occurred_at: string
          public_message: string | null
          status: Database["app_private"]["Enums"]["donation_status"]
        }
        Insert: {
          actor: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id?: string | null
          donation_id: string
          donor_visible?: boolean
          id?: string
          occurred_at?: string
          public_message?: string | null
          status: Database["app_private"]["Enums"]["donation_status"]
        }
        Update: {
          actor?: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id?: string | null
          donation_id?: string
          donor_visible?: boolean
          id?: string
          occurred_at?: string
          public_message?: string | null
          status?: Database["app_private"]["Enums"]["donation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "donation_status_events_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          campaign_id: string | null
          claim_nonce: string
          client_submission_key: string
          completed_at: string | null
          created_at: string
          donor_contact_id: string
          financial_inputs_finalized_at: string | null
          financial_inputs_finalized_by: string | null
          financial_revision: number
          id: string
          package_condition: string | null
          policy_resolution_status: string
          policy_version_snapshot_id: string | null
          public_id: string
          received_at: string | null
          received_by: string | null
          request_hash: string
          selected_charity_ein: string | null
          selected_charity_metadata: Json
          selected_charity_name: string
          selected_charity_pledge_id: string
          shipping_method: string
          status: Database["app_private"]["Enums"]["donation_status"]
          tracking_nonce: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          claim_nonce: string
          client_submission_key: string
          completed_at?: string | null
          created_at?: string
          donor_contact_id: string
          financial_inputs_finalized_at?: string | null
          financial_inputs_finalized_by?: string | null
          financial_revision?: number
          id?: string
          package_condition?: string | null
          policy_resolution_status?: string
          policy_version_snapshot_id?: string | null
          public_id: string
          received_at?: string | null
          received_by?: string | null
          request_hash: string
          selected_charity_ein?: string | null
          selected_charity_metadata?: Json
          selected_charity_name: string
          selected_charity_pledge_id: string
          shipping_method: string
          status?: Database["app_private"]["Enums"]["donation_status"]
          tracking_nonce: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          claim_nonce?: string
          client_submission_key?: string
          completed_at?: string | null
          created_at?: string
          donor_contact_id?: string
          financial_inputs_finalized_at?: string | null
          financial_inputs_finalized_by?: string | null
          financial_revision?: number
          id?: string
          package_condition?: string | null
          policy_resolution_status?: string
          policy_version_snapshot_id?: string | null
          public_id?: string
          received_at?: string | null
          received_by?: string | null
          request_hash?: string
          selected_charity_ein?: string | null
          selected_charity_metadata?: Json
          selected_charity_name?: string
          selected_charity_pledge_id?: string
          shipping_method?: string
          status?: Database["app_private"]["Enums"]["donation_status"]
          tracking_nonce?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "donations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_donor_contact_id_fkey"
            columns: ["donor_contact_id"]
            isOneToOne: false
            referencedRelation: "donor_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_policy_version_snapshot_id_fkey"
            columns: ["policy_version_snapshot_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      donor_account_links: {
        Row: {
          donor_contact_id: string
          linked_at: string
          user_id: string
        }
        Insert: {
          donor_contact_id: string
          linked_at?: string
          user_id: string
        }
        Update: {
          donor_contact_id?: string
          linked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "donor_account_links_donor_contact_id_fkey"
            columns: ["donor_contact_id"]
            isOneToOne: false
            referencedRelation: "donor_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      donor_contacts: {
        Row: {
          address_line_1: string
          address_line_2: string | null
          city: string
          country_code: string
          created_at: string
          email: string
          email_search: string
          first_name: string
          id: string
          last_name: string
          marketing_consent_at: string | null
          marketing_email_consent: boolean
          middle_name: string | null
          postal_code: string | null
          region: string | null
          storage_format_version: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address_line_1: string
          address_line_2?: string | null
          city: string
          country_code: string
          created_at?: string
          email: string
          email_search: string
          first_name: string
          id?: string
          last_name: string
          marketing_consent_at?: string | null
          marketing_email_consent?: boolean
          middle_name?: string | null
          postal_code?: string | null
          region?: string | null
          storage_format_version?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address_line_1?: string
          address_line_2?: string | null
          city?: string
          country_code?: string
          created_at?: string
          email?: string
          email_search?: string
          first_name?: string
          id?: string
          last_name?: string
          marketing_consent_at?: string | null
          marketing_email_consent?: boolean
          middle_name?: string | null
          postal_code?: string | null
          region?: string | null
          storage_format_version?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      financial_approval_policies: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          conditions: Json
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          lifecycle: Database["app_private"]["Enums"]["policy_lifecycle"]
          preparer_may_approve: boolean
          required_approvals: number
          version: number
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          conditions?: Json
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          preparer_may_approve?: boolean
          required_approvals?: number
          version: number
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          conditions?: Json
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          preparer_may_approve?: boolean
          required_approvals?: number
          version?: number
        }
        Relationships: []
      }
      financial_cost_applications: {
        Row: {
          applied_cents: number
          calculation_snapshot: Json
          cost_id: string
          policy_rule_id: string
          snapshot_id: string
        }
        Insert: {
          applied_cents: number
          calculation_snapshot: Json
          cost_id: string
          policy_rule_id: string
          snapshot_id: string
        }
        Update: {
          applied_cents?: number
          calculation_snapshot?: Json
          cost_id?: string
          policy_rule_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_cost_applications_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "donation_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_cost_applications_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "effective_donation_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_cost_applications_policy_rule_id_fkey"
            columns: ["policy_rule_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_cost_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_cost_applications_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "financial_reconciliation_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_reconciliation_devices: {
        Row: {
          device_id: string
          ordinal: number
          sale_result_id: string
          snapshot_id: string
        }
        Insert: {
          device_id: string
          ordinal: number
          sale_result_id: string
          snapshot_id: string
        }
        Update: {
          device_id?: string
          ordinal?: number
          sale_result_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_reconciliation_devices_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "donation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_devices_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "device_sale_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_devices_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "effective_device_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_devices_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "financial_reconciliation_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_reconciliation_snapshots: {
        Row: {
          donation_id: string
          eligible_device_count: number
          finalized_at: string
          finalized_by: string
          id: string
          revision: number
        }
        Insert: {
          donation_id: string
          eligible_device_count: number
          finalized_at?: string
          finalized_by: string
          id?: string
          revision: number
        }
        Update: {
          donation_id?: string
          eligible_device_count?: number
          finalized_at?: string
          finalized_by?: string
          id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_reconciliation_snapshots_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_assets: {
        Row: {
          alt_text: string
          asset_kind: string
          byte_size: number
          content_sha256: string
          created_at: string
          height_pixels: number
          id: string
          is_decorative: boolean
          metadata_scrubbed: boolean
          mime_type: string
          organization_id: string
          storage_path: string
          uploaded_by: string
          width_pixels: number
        }
        Insert: {
          alt_text?: string
          asset_kind: string
          byte_size: number
          content_sha256: string
          created_at?: string
          height_pixels: number
          id?: string
          is_decorative?: boolean
          metadata_scrubbed?: boolean
          mime_type: string
          organization_id: string
          storage_path: string
          uploaded_by: string
          width_pixels: number
        }
        Update: {
          alt_text?: string
          asset_kind?: string
          byte_size?: number
          content_sha256?: string
          created_at?: string
          height_pixels?: number
          id?: string
          is_decorative?: boolean
          metadata_scrubbed?: boolean
          mime_type?: string
          organization_id?: string
          storage_path?: string
          uploaded_by?: string
          width_pixels?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_charities: {
        Row: {
          charity_id: string
          created_at: string
          organization_id: string
          status: Database["app_private"]["Enums"]["charity_verification_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          charity_id: string
          created_at?: string
          organization_id: string
          status?: Database["app_private"]["Enums"]["charity_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          charity_id?: string
          created_at?: string
          organization_id?: string
          status?: Database["app_private"]["Enums"]["charity_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_charities_charity_id_fkey"
            columns: ["charity_id"]
            isOneToOne: false
            referencedRelation: "charities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_charities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          activated_at: string | null
          invited_at: string
          invited_by: string | null
          organization_id: string
          role: Database["app_private"]["Enums"]["organization_role"]
          status: Database["app_private"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          invited_at?: string
          invited_by?: string | null
          organization_id: string
          role: Database["app_private"]["Enums"]["organization_role"]
          status?: Database["app_private"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          invited_at?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["app_private"]["Enums"]["organization_role"]
          status?: Database["app_private"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profile_drafts: {
        Row: {
          country_code: string
          hero_asset_id: string | null
          locality: string | null
          lock_version: number
          logo_asset_id: string | null
          mission: string
          organization_id: string
          region: string | null
          review_feedback: string | null
          review_state: string
          summary: string
          updated_at: string
          updated_by: string | null
          website_url: string | null
        }
        Insert: {
          country_code?: string
          hero_asset_id?: string | null
          locality?: string | null
          lock_version?: number
          logo_asset_id?: string | null
          mission?: string
          organization_id: string
          region?: string | null
          review_feedback?: string | null
          review_state?: string
          summary?: string
          updated_at?: string
          updated_by?: string | null
          website_url?: string | null
        }
        Update: {
          country_code?: string
          hero_asset_id?: string | null
          locality?: string | null
          lock_version?: number
          logo_asset_id?: string | null
          mission?: string
          organization_id?: string
          region?: string | null
          review_feedback?: string | null
          review_state?: string
          summary?: string
          updated_at?: string
          updated_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_profile_drafts_hero_asset_id_fkey"
            columns: ["hero_asset_id"]
            isOneToOne: false
            referencedRelation: "organization_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profile_drafts_logo_asset_id_fkey"
            columns: ["logo_asset_id"]
            isOneToOne: false
            referencedRelation: "organization_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profile_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profile_reviews: {
        Row: {
          actor_kind: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id: string | null
          created_at: string
          feedback: string | null
          id: string
          organization_id: string
          outcome: Database["app_private"]["Enums"]["review_outcome"]
          revision_id: string
        }
        Insert: {
          actor_kind: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id?: string | null
          created_at?: string
          feedback?: string | null
          id?: string
          organization_id: string
          outcome: Database["app_private"]["Enums"]["review_outcome"]
          revision_id: string
        }
        Update: {
          actor_kind?: Database["app_private"]["Enums"]["actor_kind"]
          actor_user_id?: string | null
          created_at?: string
          feedback?: string | null
          id?: string
          organization_id?: string
          outcome?: Database["app_private"]["Enums"]["review_outcome"]
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_profile_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profile_reviews_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "organization_profile_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profile_revisions: {
        Row: {
          approved_by: string | null
          content_hash: string
          country_code: string
          created_at: string
          hero_asset_id: string | null
          hero_asset_sha256: string | null
          id: string
          locality: string | null
          logo_asset_id: string | null
          logo_asset_sha256: string | null
          mission: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          region: string | null
          requested_by: string | null
          status: Database["app_private"]["Enums"]["profile_revision_status"]
          summary: string
          version: number
          website_url: string
        }
        Insert: {
          approved_by?: string | null
          content_hash: string
          country_code: string
          created_at?: string
          hero_asset_id?: string | null
          hero_asset_sha256?: string | null
          id?: string
          locality?: string | null
          logo_asset_id?: string | null
          logo_asset_sha256?: string | null
          mission: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          region?: string | null
          requested_by?: string | null
          status?: Database["app_private"]["Enums"]["profile_revision_status"]
          summary: string
          version: number
          website_url: string
        }
        Update: {
          approved_by?: string | null
          content_hash?: string
          country_code?: string
          created_at?: string
          hero_asset_id?: string | null
          hero_asset_sha256?: string | null
          id?: string
          locality?: string | null
          logo_asset_id?: string | null
          logo_asset_sha256?: string | null
          mission?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          region?: string | null
          requested_by?: string | null
          status?: Database["app_private"]["Enums"]["profile_revision_status"]
          summary?: string
          version?: number
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_profile_revisions_hero_asset_id_fkey"
            columns: ["hero_asset_id"]
            isOneToOne: false
            referencedRelation: "organization_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profile_revisions_logo_asset_id_fkey"
            columns: ["logo_asset_id"]
            isOneToOne: false
            referencedRelation: "organization_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profile_revisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          active_profile_revision_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          status: Database["app_private"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          active_profile_revision_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          status?: Database["app_private"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          active_profile_revision_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          status?: Database["app_private"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_active_profile_revision_id_fkey"
            columns: ["active_profile_revision_id"]
            isOneToOne: false
            referencedRelation: "organization_profile_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_events: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          domain_event_id: string
          event_type: string
          handler_key: string
          id: string
          last_error_code: string | null
          locked_by: string | null
          locked_until: string | null
          max_attempts: number
          payload: Json
          status: Database["app_private"]["Enums"]["outbox_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          domain_event_id: string
          event_type: string
          handler_key: string
          id?: string
          last_error_code?: string | null
          locked_by?: string | null
          locked_until?: string | null
          max_attempts?: number
          payload?: Json
          status?: Database["app_private"]["Enums"]["outbox_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          domain_event_id?: string
          event_type?: string
          handler_key?: string
          id?: string
          last_error_code?: string | null
          locked_by?: string | null
          locked_until?: string | null
          max_attempts?: number
          payload?: Json
          status?: Database["app_private"]["Enums"]["outbox_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_events_domain_event_id_fkey"
            columns: ["domain_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_handler_receipts: {
        Row: {
          completed_at: string
          handler_name: string
          outbox_event_id: string
          result_metadata: Json
        }
        Insert: {
          completed_at?: string
          handler_name: string
          outbox_event_id: string
          result_metadata?: Json
        }
        Update: {
          completed_at?: string
          handler_name?: string
          outbox_event_id?: string
          result_metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "outbox_handler_receipts_outbox_event_id_fkey"
            columns: ["outbox_event_id"]
            isOneToOne: false
            referencedRelation: "outbox_events"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_application_contacts: {
        Row: {
          contact_name: string
          created_at: string
          email_search: string
          id: string
          role_title: string
          storage_format_version: number
        }
        Insert: {
          contact_name: string
          created_at?: string
          email_search: string
          id?: string
          role_title: string
          storage_format_version?: number
        }
        Update: {
          contact_name?: string
          created_at?: string
          email_search?: string
          id?: string
          role_title?: string
          storage_format_version?: number
        }
        Relationships: []
      }
      partner_applications: {
        Row: {
          audience_summary: string
          consented_at: string
          contact_id: string
          created_at: string
          desired_timing: string
          goal_summary: string
          id: string
          idempotency_key: string
          organization_id: string | null
          organization_name: string
          partner_lead_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["app_private"]["Enums"]["partner_application_status"]
          submitted_session_hash: string
          updated_at: string
          website_url: string
        }
        Insert: {
          audience_summary: string
          consented_at: string
          contact_id: string
          created_at?: string
          desired_timing: string
          goal_summary: string
          id?: string
          idempotency_key: string
          organization_id?: string | null
          organization_name: string
          partner_lead_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["app_private"]["Enums"]["partner_application_status"]
          submitted_session_hash: string
          updated_at?: string
          website_url: string
        }
        Update: {
          audience_summary?: string
          consented_at?: string
          contact_id?: string
          created_at?: string
          desired_timing?: string
          goal_summary?: string
          id?: string
          idempotency_key?: string
          organization_id?: string | null
          organization_name?: string
          partner_lead_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["app_private"]["Enums"]["partner_application_status"]
          submitted_session_hash?: string
          updated_at?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_applications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "partner_application_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_applications_partner_lead_id_fkey"
            columns: ["partner_lead_id"]
            isOneToOne: false
            referencedRelation: "partner_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_invitations: {
        Row: {
          accepted_once: boolean
          activated_at: string | null
          activated_by: string | null
          email_search: string
          expires_at: string
          id: string
          invited_at: string
          invited_by: string
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          role: Database["app_private"]["Enums"]["organization_role"]
          status: Database["app_private"]["Enums"]["membership_status"]
          suspended_at: string | null
          suspended_by: string | null
        }
        Insert: {
          accepted_once?: boolean
          activated_at?: string | null
          activated_by?: string | null
          email_search: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by: string
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["app_private"]["Enums"]["organization_role"]
          status?: Database["app_private"]["Enums"]["membership_status"]
          suspended_at?: string | null
          suspended_by?: string | null
        }
        Update: {
          accepted_once?: boolean
          activated_at?: string | null
          activated_by?: string | null
          email_search?: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["app_private"]["Enums"]["organization_role"]
          status?: Database["app_private"]["Enums"]["membership_status"]
          suspended_at?: string | null
          suspended_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_leads: {
        Row: {
          agent_action_id: string | null
          application_id: string | null
          audience_summary: string | null
          contact_id: string | null
          created_at: string
          created_by_agent_ref: string
          external_thread_ref: string | null
          goal_summary: string | null
          id: string
          organization_id: string | null
          organization_name: string
          request_summary: string
          requester_email_search: string
          status: string
          timing_summary: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          agent_action_id?: string | null
          application_id?: string | null
          audience_summary?: string | null
          contact_id?: string | null
          created_at?: string
          created_by_agent_ref: string
          external_thread_ref?: string | null
          goal_summary?: string | null
          id?: string
          organization_id?: string | null
          organization_name: string
          request_summary: string
          requester_email_search: string
          status?: string
          timing_summary?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          agent_action_id?: string | null
          application_id?: string | null
          audience_summary?: string | null
          contact_id?: string | null
          created_at?: string
          created_by_agent_ref?: string
          external_thread_ref?: string | null
          goal_summary?: string | null
          id?: string
          organization_id?: string | null
          organization_name?: string
          request_summary?: string
          requester_email_search?: string
          status?: string
          timing_summary?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_leads_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: true
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_leads_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "partner_application_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_donation_claims: {
        Row: {
          consumed_at: string | null
          created_at: string
          donation_id: string
          expires_at: string
          id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          donation_id: string
          expires_at: string
          id?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          donation_id?: string
          expires_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_donation_claims_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
        ]
      }
      proceeds_allocations: {
        Row: {
          allocable_base_cents: number
          allocated_cents: number | null
          beneficiary_charity_id: string | null
          beneficiary_pledge_id: string
          calculated_at: string | null
          calculated_by: string | null
          calculation_snapshot: Json
          campaign_id: string | null
          created_at: string
          currency: string
          donation_id: string
          eligible_cost_cents: number
          gross_cents: number
          id: string
          organization_id: string | null
          policy_version_id: string | null
          reconciliation_snapshot_id: string | null
          reversal_of: string | null
          sale_result_id: string | null
          settlement_status: string
          share_basis_points: number | null
          status: Database["app_private"]["Enums"]["allocation_status"]
        }
        Insert: {
          allocable_base_cents: number
          allocated_cents?: number | null
          beneficiary_charity_id?: string | null
          beneficiary_pledge_id: string
          calculated_at?: string | null
          calculated_by?: string | null
          calculation_snapshot?: Json
          campaign_id?: string | null
          created_at?: string
          currency?: string
          donation_id: string
          eligible_cost_cents?: number
          gross_cents: number
          id?: string
          organization_id?: string | null
          policy_version_id?: string | null
          reconciliation_snapshot_id?: string | null
          reversal_of?: string | null
          sale_result_id?: string | null
          settlement_status?: string
          share_basis_points?: number | null
          status?: Database["app_private"]["Enums"]["allocation_status"]
        }
        Update: {
          allocable_base_cents?: number
          allocated_cents?: number | null
          beneficiary_charity_id?: string | null
          beneficiary_pledge_id?: string
          calculated_at?: string | null
          calculated_by?: string | null
          calculation_snapshot?: Json
          campaign_id?: string | null
          created_at?: string
          currency?: string
          donation_id?: string
          eligible_cost_cents?: number
          gross_cents?: number
          id?: string
          organization_id?: string | null
          policy_version_id?: string | null
          reconciliation_snapshot_id?: string | null
          reversal_of?: string | null
          sale_result_id?: string | null
          settlement_status?: string
          share_basis_points?: number | null
          status?: Database["app_private"]["Enums"]["allocation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "proceeds_allocations_beneficiary_charity_id_fkey"
            columns: ["beneficiary_charity_id"]
            isOneToOne: false
            referencedRelation: "charities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_reconciliation_snapshot_id_fkey"
            columns: ["reconciliation_snapshot_id"]
            isOneToOne: false
            referencedRelation: "financial_reconciliation_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "effective_proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "device_sale_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "effective_device_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      proceeds_policies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lifecycle: Database["app_private"]["Enums"]["policy_lifecycle"]
          name: string
          policy_key: string
          purpose: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          name: string
          policy_key: string
          purpose: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          name?: string
          policy_key?: string
          purpose?: string
          updated_at?: string
        }
        Relationships: []
      }
      proceeds_policy_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          enabled: boolean
          id: string
          policy_version_id: string
          precedence: number
          scope: Database["app_private"]["Enums"]["proceeds_scope"]
          scope_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          enabled?: boolean
          id?: string
          policy_version_id: string
          precedence?: number
          scope: Database["app_private"]["Enums"]["proceeds_scope"]
          scope_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          enabled?: boolean
          id?: string
          policy_version_id?: string
          precedence?: number
          scope?: Database["app_private"]["Enums"]["proceeds_scope"]
          scope_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proceeds_policy_assignments_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      proceeds_policy_cost_rules: {
        Row: {
          allocation_method: Database["app_private"]["Enums"]["cost_allocation_method"]
          cap_basis_points: number | null
          cost_category: string
          deductible: boolean
          id: string
          metadata: Json
          policy_version_id: string
          priority: number
        }
        Insert: {
          allocation_method: Database["app_private"]["Enums"]["cost_allocation_method"]
          cap_basis_points?: number | null
          cost_category: string
          deductible: boolean
          id?: string
          metadata?: Json
          policy_version_id: string
          priority?: number
        }
        Update: {
          allocation_method?: Database["app_private"]["Enums"]["cost_allocation_method"]
          cap_basis_points?: number | null
          cost_category?: string
          deductible?: boolean
          id?: string
          metadata?: Json
          policy_version_id?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "proceeds_policy_cost_rules_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      proceeds_policy_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          calculation_method: Database["app_private"]["Enums"]["proceeds_calculation_method"]
          created_at: string
          created_by: string | null
          currency: string
          effective_from: string
          effective_to: string | null
          eligibility_rule_schema_version: number
          eligibility_rules: Json
          id: string
          lifecycle: Database["app_private"]["Enums"]["policy_lifecycle"]
          policy_id: string
          share_basis_points: number | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          calculation_method: Database["app_private"]["Enums"]["proceeds_calculation_method"]
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from: string
          effective_to?: string | null
          eligibility_rule_schema_version?: number
          eligibility_rules?: Json
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          policy_id: string
          share_basis_points?: number | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          calculation_method?: Database["app_private"]["Enums"]["proceeds_calculation_method"]
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          effective_to?: string | null
          eligibility_rule_schema_version?: number
          eligibility_rules?: Json
          id?: string
          lifecycle?: Database["app_private"]["Enums"]["policy_lifecycle"]
          policy_id?: string
          share_basis_points?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "proceeds_policy_versions_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reserved_route_slugs: {
        Row: {
          created_at: string
          permanent: boolean
          reason: string
          slug: string
        }
        Insert: {
          created_at?: string
          permanent?: boolean
          reason: string
          slug: string
        }
        Update: {
          created_at?: string
          permanent?: boolean
          reason?: string
          slug?: string
        }
        Relationships: []
      }
      semantic_command_registry: {
        Row: {
          command_name: string
          description: string
          human_only: boolean
        }
        Insert: {
          command_name: string
          description: string
          human_only: boolean
        }
        Update: {
          command_name?: string
          description?: string
          human_only?: boolean
        }
        Relationships: []
      }
      staff_memberships: {
        Row: {
          activated_at: string | null
          invited_at: string
          invited_by: string | null
          role: Database["app_private"]["Enums"]["staff_role"]
          status: Database["app_private"]["Enums"]["membership_status"]
          suspended_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          invited_at?: string
          invited_by?: string | null
          role: Database["app_private"]["Enums"]["staff_role"]
          status?: Database["app_private"]["Enums"]["membership_status"]
          suspended_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          invited_at?: string
          invited_by?: string | null
          role?: Database["app_private"]["Enums"]["staff_role"]
          status?: Database["app_private"]["Enums"]["membership_status"]
          suspended_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      effective_device_sales: {
        Row: {
          channel: string | null
          created_at: string | null
          currency: string | null
          device_id: string | null
          external_reference: string | null
          gross_amount_cents: number | null
          id: string | null
          recorded_by: string | null
          reversal_of: string | null
          sold_at: string | null
          status:
            | Database["app_private"]["Enums"]["financial_entry_status"]
            | null
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          currency?: string | null
          device_id?: string | null
          external_reference?: string | null
          gross_amount_cents?: number | null
          id?: string | null
          recorded_by?: string | null
          reversal_of?: string | null
          sold_at?: string | null
          status?:
            | Database["app_private"]["Enums"]["financial_entry_status"]
            | null
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          currency?: string | null
          device_id?: string | null
          external_reference?: string | null
          gross_amount_cents?: number | null
          id?: string | null
          recorded_by?: string | null
          reversal_of?: string | null
          sold_at?: string | null
          status?:
            | Database["app_private"]["Enums"]["financial_entry_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "device_sale_results_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "donation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sale_results_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "device_sale_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sale_results_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "effective_device_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      effective_donation_costs: {
        Row: {
          amount_cents: number | null
          category: string | null
          created_at: string | null
          currency: string | null
          device_id: string | null
          donation_id: string | null
          evidence_reference: string | null
          id: string | null
          incurred_at: string | null
          recorded_by: string | null
          reversal_of: string | null
          status:
            | Database["app_private"]["Enums"]["financial_entry_status"]
            | null
        }
        Insert: {
          amount_cents?: number | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          device_id?: string | null
          donation_id?: string | null
          evidence_reference?: string | null
          id?: string | null
          incurred_at?: string | null
          recorded_by?: string | null
          reversal_of?: string | null
          status?:
            | Database["app_private"]["Enums"]["financial_entry_status"]
            | null
        }
        Update: {
          amount_cents?: number | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          device_id?: string | null
          donation_id?: string | null
          evidence_reference?: string | null
          id?: string | null
          incurred_at?: string | null
          recorded_by?: string | null
          reversal_of?: string | null
          status?:
            | Database["app_private"]["Enums"]["financial_entry_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "donation_costs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "donation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_costs_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_costs_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "donation_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_costs_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "effective_donation_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      effective_proceeds_allocations: {
        Row: {
          allocable_base_cents: number | null
          allocated_cents: number | null
          beneficiary_charity_id: string | null
          beneficiary_pledge_id: string | null
          calculated_at: string | null
          calculated_by: string | null
          calculation_snapshot: Json | null
          campaign_id: string | null
          created_at: string | null
          currency: string | null
          donation_id: string | null
          eligible_cost_cents: number | null
          gross_cents: number | null
          id: string | null
          organization_id: string | null
          policy_version_id: string | null
          reconciliation_snapshot_id: string | null
          reversal_of: string | null
          sale_result_id: string | null
          share_basis_points: number | null
          status: Database["app_private"]["Enums"]["allocation_status"] | null
        }
        Insert: {
          allocable_base_cents?: number | null
          allocated_cents?: number | null
          beneficiary_charity_id?: string | null
          beneficiary_pledge_id?: string | null
          calculated_at?: string | null
          calculated_by?: string | null
          calculation_snapshot?: Json | null
          campaign_id?: string | null
          created_at?: string | null
          currency?: string | null
          donation_id?: string | null
          eligible_cost_cents?: number | null
          gross_cents?: number | null
          id?: string | null
          organization_id?: string | null
          policy_version_id?: string | null
          reconciliation_snapshot_id?: string | null
          reversal_of?: string | null
          sale_result_id?: string | null
          share_basis_points?: number | null
          status?: Database["app_private"]["Enums"]["allocation_status"] | null
        }
        Update: {
          allocable_base_cents?: number | null
          allocated_cents?: number | null
          beneficiary_charity_id?: string | null
          beneficiary_pledge_id?: string | null
          calculated_at?: string | null
          calculated_by?: string | null
          calculation_snapshot?: Json | null
          campaign_id?: string | null
          created_at?: string | null
          currency?: string | null
          donation_id?: string | null
          eligible_cost_cents?: number | null
          gross_cents?: number | null
          id?: string | null
          organization_id?: string | null
          policy_version_id?: string | null
          reconciliation_snapshot_id?: string | null
          reversal_of?: string | null
          sale_result_id?: string | null
          share_basis_points?: number | null
          status?: Database["app_private"]["Enums"]["allocation_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "proceeds_allocations_beneficiary_charity_id_fkey"
            columns: ["beneficiary_charity_id"]
            isOneToOne: false
            referencedRelation: "charities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "proceeds_policy_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_reconciliation_snapshot_id_fkey"
            columns: ["reconciliation_snapshot_id"]
            isOneToOne: false
            referencedRelation: "financial_reconciliation_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "effective_proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "proceeds_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "device_sale_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proceeds_allocations_sale_result_id_fkey"
            columns: ["sale_result_id"]
            isOneToOne: false
            referencedRelation: "effective_device_sales"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_context_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      article_content_hash: {
        Args: {
          author_name_value: string
          blocks_value: Json
          excerpt_value: string
          seo_description_value: string
          seo_title_value: string
          title_value: string
        }
        Returns: string
      }
      assert_active_admin: {
        Args: { actor_user_id: string }
        Returns: undefined
      }
      assert_active_staff: {
        Args: { actor_user_id: string }
        Returns: undefined
      }
      assert_agent_identity: {
        Args: { agent_identity: string }
        Returns: undefined
      }
      assert_article_revision_link: {
        Args: {
          article_id_value: string
          link_name: string
          revision_id_value: string
        }
        Returns: undefined
      }
      assert_current_agent_message_context: {
        Args: { authorization_value: string }
        Returns: undefined
      }
      assert_org_admin: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: undefined
      }
      assert_org_editor: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: undefined
      }
      assert_org_member: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: undefined
      }
      assert_org_viewer: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: undefined
      }
      assert_service_role: { Args: never; Returns: undefined }
      bound_jsonb_array: {
        Args: { maximum: number; value: Json }
        Returns: Json
      }
      bound_jsonb_array_field: {
        Args: { field_name: string; maximum: number; value: Json }
        Returns: Json
      }
      calculate_policy_cost_cents: {
        Args: {
          allocation_method: Database["app_private"]["Enums"]["cost_allocation_method"]
          cap_basis_points: number
          cost_amount_cents: number
          gross_proceeds_cents: number
          rule_metadata: Json
        }
        Returns: number
      }
      donor_account_overview_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      new_donation_public_id: {
        Args: { created_time: string }
        Returns: string
      }
      normalized_partner_role: {
        Args: {
          role_value: Database["app_private"]["Enums"]["organization_role"]
        }
        Returns: string
      }
      partner_campaign_detail_unbounded: {
        Args: { actor_user_id: string; candidate_campaign_id: string }
        Returns: Json
      }
      partner_campaign_workspace_unbounded: {
        Args: { actor_user_id: string; candidate_campaign_id: string }
        Returns: Json
      }
      partner_overview_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      partner_profile_detail_unbounded: {
        Args: { actor_user_id: string; candidate_organization_id: string }
        Returns: Json
      }
      partner_workspace_unfiltered: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_campaign_overview_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_financial_overview_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_get_donation_financials_unbounded: {
        Args: { actor_user_id: string; candidate_donation_id: string }
        Returns: Json
      }
      staff_get_donation_unbounded: {
        Args: { actor_user_id: string; candidate_donation_id: string }
        Returns: Json
      }
      staff_partner_application_queue_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_partner_overview_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      staff_partner_review_queue_unbounded: {
        Args: { actor_user_id: string }
        Returns: Json
      }
      support_content_hash: {
        Args: {
          body_value: string
          campaign_value: string
          donation_value: string
          message_category: string
          organization_value: string
          recipient_email: string
          subject_value: string
        }
        Returns: string
      }
      valid_donation_transition: {
        Args: {
          new_status: Database["app_private"]["Enums"]["donation_status"]
          old_status: Database["app_private"]["Enums"]["donation_status"]
        }
        Returns: boolean
      }
      validate_article_blocks: { Args: { blocks: Json }; Returns: boolean }
      validate_campaign_blocks: {
        Args: { blocks_value: Json }
        Returns: boolean
      }
      validate_campaign_blocks_v2: { Args: { blocks: Json }; Returns: boolean }
      validate_campaign_toolkit: { Args: { toolkit: Json }; Returns: boolean }
    }
    Enums: {
      action_execution_status:
        | "pending"
        | "allowed"
        | "awaiting_approval"
        | "escalated"
        | "denied"
        | "executed"
        | "failed"
      action_policy_outcome:
        | "ALLOW_AUTOMATICALLY"
        | "REQUIRE_APPROVAL"
        | "ESCALATE"
        | "DENY"
      actor_kind: "donor" | "partner" | "staff" | "service" | "agent" | "system"
      agent_action_status:
        | "proposed"
        | "approved"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
      allocation_status:
        | "policy_hold"
        | "calculated"
        | "approved"
        | "disbursed"
        | "reversed"
      approval_outcome: "approved" | "rejected" | "expired" | "cancelled"
      article_status: "draft" | "scheduled" | "published" | "archived"
      campaign_alias_behavior: "redirect" | "render"
      campaign_alias_status: "active" | "retired"
      campaign_revision_status:
        | "draft"
        | "approved"
        | "published"
        | "superseded"
        | "rejected"
        | "partner_review"
        | "staff_review"
      campaign_status:
        | "draft"
        | "review"
        | "published"
        | "paused"
        | "completed"
        | "archived"
        | "partner_review"
        | "staff_review"
        | "scheduled"
        | "ended"
      charity_verification_status:
        | "pending"
        | "verified"
        | "suspended"
        | "retired"
      cost_allocation_method: "direct" | "pro_rata" | "fixed" | "capped"
      data_wipe_status:
        | "not_started"
        | "pending"
        | "completed"
        | "not_required"
        | "blocked"
      device_inspection_status:
        | "pending"
        | "inspecting"
        | "inspected"
        | "blocked"
      device_processing_status:
        | "pending"
        | "reuse"
        | "resale"
        | "parts"
        | "recycle"
        | "returned"
        | "complete"
      device_receipt_status: "expected" | "received" | "missing" | "unexpected"
      device_source: "expected" | "unexpected"
      disbursement_status:
        | "prepared"
        | "approved"
        | "completed"
        | "cancelled"
        | "reversed"
      donation_status:
        | "submitted"
        | "in_transit"
        | "received"
        | "inspecting"
        | "processing"
        | "completed"
        | "exception"
        | "cancelled"
      escalation_status: "open" | "acknowledged" | "resolved" | "dismissed"
      financial_entry_status: "draft" | "recorded" | "reversed"
      membership_status: "invited" | "active" | "suspended" | "removed"
      organization_role:
        | "partner_member"
        | "partner_admin"
        | "partner_editor"
        | "partner_viewer"
      organization_status: "prospect" | "active" | "paused" | "ended"
      outbox_status: "pending" | "processing" | "retry" | "completed" | "failed"
      partner_application_status:
        | "new"
        | "under_review"
        | "needs_information"
        | "verified"
        | "declined"
        | "converted"
      policy_lifecycle: "draft" | "approved" | "active" | "retired"
      proceeds_calculation_method:
        | "net_proceeds_share"
        | "fixed_amount"
        | "custom"
      proceeds_scope: "general" | "charity" | "partnership" | "campaign"
      profile_revision_status:
        | "draft"
        | "staff_review"
        | "approved"
        | "published"
        | "superseded"
        | "rejected"
      review_outcome:
        | "requested"
        | "approved"
        | "changes_requested"
        | "published"
        | "scheduled"
        | "withdrawn"
      risk_level: "low" | "moderate" | "high" | "critical"
      shipment_direction: "inbound" | "return"
      shipment_status:
        | "not_mailed"
        | "mailed"
        | "in_transit"
        | "delivered"
        | "exception"
        | "returned"
      staff_role: "staff" | "admin"
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
  api: {
    Enums: {},
  },
  app_private: {
    Enums: {
      action_execution_status: [
        "pending",
        "allowed",
        "awaiting_approval",
        "escalated",
        "denied",
        "executed",
        "failed",
      ],
      action_policy_outcome: [
        "ALLOW_AUTOMATICALLY",
        "REQUIRE_APPROVAL",
        "ESCALATE",
        "DENY",
      ],
      actor_kind: ["donor", "partner", "staff", "service", "agent", "system"],
      agent_action_status: [
        "proposed",
        "approved",
        "running",
        "completed",
        "failed",
        "cancelled",
      ],
      allocation_status: [
        "policy_hold",
        "calculated",
        "approved",
        "disbursed",
        "reversed",
      ],
      approval_outcome: ["approved", "rejected", "expired", "cancelled"],
      article_status: ["draft", "scheduled", "published", "archived"],
      campaign_alias_behavior: ["redirect", "render"],
      campaign_alias_status: ["active", "retired"],
      campaign_revision_status: [
        "draft",
        "approved",
        "published",
        "superseded",
        "rejected",
        "partner_review",
        "staff_review",
      ],
      campaign_status: [
        "draft",
        "review",
        "published",
        "paused",
        "completed",
        "archived",
        "partner_review",
        "staff_review",
        "scheduled",
        "ended",
      ],
      charity_verification_status: [
        "pending",
        "verified",
        "suspended",
        "retired",
      ],
      cost_allocation_method: ["direct", "pro_rata", "fixed", "capped"],
      data_wipe_status: [
        "not_started",
        "pending",
        "completed",
        "not_required",
        "blocked",
      ],
      device_inspection_status: [
        "pending",
        "inspecting",
        "inspected",
        "blocked",
      ],
      device_processing_status: [
        "pending",
        "reuse",
        "resale",
        "parts",
        "recycle",
        "returned",
        "complete",
      ],
      device_receipt_status: ["expected", "received", "missing", "unexpected"],
      device_source: ["expected", "unexpected"],
      disbursement_status: [
        "prepared",
        "approved",
        "completed",
        "cancelled",
        "reversed",
      ],
      donation_status: [
        "submitted",
        "in_transit",
        "received",
        "inspecting",
        "processing",
        "completed",
        "exception",
        "cancelled",
      ],
      escalation_status: ["open", "acknowledged", "resolved", "dismissed"],
      financial_entry_status: ["draft", "recorded", "reversed"],
      membership_status: ["invited", "active", "suspended", "removed"],
      organization_role: [
        "partner_member",
        "partner_admin",
        "partner_editor",
        "partner_viewer",
      ],
      organization_status: ["prospect", "active", "paused", "ended"],
      outbox_status: ["pending", "processing", "retry", "completed", "failed"],
      partner_application_status: [
        "new",
        "under_review",
        "needs_information",
        "verified",
        "declined",
        "converted",
      ],
      policy_lifecycle: ["draft", "approved", "active", "retired"],
      proceeds_calculation_method: [
        "net_proceeds_share",
        "fixed_amount",
        "custom",
      ],
      proceeds_scope: ["general", "charity", "partnership", "campaign"],
      profile_revision_status: [
        "draft",
        "staff_review",
        "approved",
        "published",
        "superseded",
        "rejected",
      ],
      review_outcome: [
        "requested",
        "approved",
        "changes_requested",
        "published",
        "scheduled",
        "withdrawn",
      ],
      risk_level: ["low", "moderate", "high", "critical"],
      shipment_direction: ["inbound", "return"],
      shipment_status: [
        "not_mailed",
        "mailed",
        "in_transit",
        "delivered",
        "exception",
        "returned",
      ],
      staff_role: ["staff", "admin"],
    },
  },
} as const
