from pymongo import MongoClient, ASCENDING, DESCENDING
from gridfs import GridFS

from core.config import settings


client = MongoClient(settings.mongodb_url)

database = client[settings.database_name]

users_collection = database["users"]

password_reset_tokens_collection = database["password_reset_tokens"]

email_verification_tokens_collection = database["email_verification_tokens"]

families_collection = database["families"]

family_members_collection = database["family_members"]

invite_codes_collection = database["invite_codes"]

messages_collection = database["messages"]

notifications_collection = database["notifications"]

push_subscriptions_collection = database["push_subscriptions"]

oauth_states_collection = database["oauth_states"]

fs = GridFS(database)


password_reset_tokens_collection.create_index(
    "expires_at",
    expireAfterSeconds=0
)

email_verification_tokens_collection.create_index(
    "expires_at",
    expireAfterSeconds=0
)
email_verification_tokens_collection.create_index(
    [("user_id", ASCENDING), ("created_at", DESCENDING)]
)

# Unique member: one user can only be in one family
family_members_collection.create_index(
    [("user_id", ASCENDING)],
    unique=True,
    name="user_id_1"
)

# Auto-delete expired invite codes
invite_codes_collection.create_index(
    "expires_at",
    expireAfterSeconds=0
)

# Fast invite-code lookups (status/uses checked in service layer)
invite_codes_collection.create_index(
    "code",
    name="invite_code_1"
)

# Chat indexes
messages_collection.create_index(
    [("family_id", ASCENDING), ("created_at", DESCENDING)]
)

# Notification indexes
notifications_collection.create_index(
    [("user_id", ASCENDING), ("created_at", DESCENDING)]
)
notifications_collection.create_index(
    [("user_id", ASCENDING), ("is_read", ASCENDING)]
)
notifications_collection.create_index(
    "created_at",
    expireAfterSeconds=2592000  # 30 days TTL
)

# Push subscription indexes
push_subscriptions_collection.create_index(
    [("user_id", ASCENDING)],
    unique=True
)

# OAuth states (auto-expire after 10 minutes)
oauth_states_collection.create_index(
    "expires_at",
    expireAfterSeconds=0
)

# ─── AI Collections ───

ai_conversations_collection = database["ai_conversations"]
ai_messages_collection = database["ai_messages"]

ai_conversations_collection.create_index(
    [("user_id", ASCENDING), ("updated_at", DESCENDING)]
)
ai_conversations_collection.create_index(
    "conversation_id",
    unique=True
)

ai_messages_collection.create_index(
    [("conversation_id", ASCENDING), ("created_at", ASCENDING)]
)
ai_messages_collection.create_index(
    "message_id",
    unique=True
)

# ─── AI Share Collections ───

ai_shared_conversations_collection = database["ai_shared_conversations"]
ai_shared_messages_collection = database["ai_shared_messages"]

ai_shared_conversations_collection.create_index(
    "share_id",
    unique=True
)
ai_shared_conversations_collection.create_index(
    "conversation_id"
)
ai_shared_conversations_collection.create_index(
    [("family_id", ASCENDING), ("status", ASCENDING)]
)

ai_shared_messages_collection.create_index(
    [("share_id", ASCENDING), ("created_at", ASCENDING)]
)
# One active share per conversation (revoked shares don't count).
# Guarded: if duplicate active shares already exist, the app still boots
# and the service-level check remains as fallback.
try:
    ai_shared_conversations_collection.create_index(
        "conversation_id",
        unique=True,
        partialFilterExpression={"status": "active"},
        name="active_share_per_conversation",
    )
except Exception:
    pass

# ─── Case Collections (Ask Family) ───

cases_collection = database["cases"]
case_messages_collection = database["case_messages"]

cases_collection.create_index(
    "case_id",
    unique=True
)
cases_collection.create_index(
    [("family_id", ASCENDING), ("status", ASCENDING), ("updated_at", DESCENDING)]
)
cases_collection.create_index(
    [("created_by", ASCENDING), ("updated_at", DESCENDING)]
)

case_messages_collection.create_index(
    [("case_id", ASCENDING), ("created_at", ASCENDING)]
)

# ─── Review Collections (Family Review) ───

ai_review_shares_collection = database["ai_review_shares"]
ai_review_responses_collection = database["ai_review_responses"]

ai_review_shares_collection.create_index(
    "share_id",
    unique=True
)
ai_review_shares_collection.create_index(
    [("family_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)]
)
ai_review_shares_collection.create_index(
    [("shared_by", ASCENDING), ("created_at", DESCENDING)]
)
ai_review_shares_collection.create_index(
    "selected_ids"
)

ai_review_responses_collection.create_index(
    "share_id"
)
ai_review_responses_collection.create_index(
    [("share_id", ASCENDING), ("responder_id", ASCENDING)],
    unique=True,
    name="one_response_per_user_per_review",
)
