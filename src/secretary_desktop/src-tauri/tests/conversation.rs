use secretary_desktop_spike::{presentation::external_url, protocol::Query, storage::Storage};
use serde_json::json;
#[test]
fn failed_and_unresolved_original_bodies_survive_cleanup_and_are_reachable_past_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Storage::open(&dir.path().join("client")).unwrap();
    s.bind("d", "i").unwrap();
    let mut ids = Vec::new();
    for _ in 0..60 {
        let id = uuid::Uuid::new_v4().to_string();
        s.enqueue(
            "d",
            "i",
            &Query::new("messages"),
            &json!({"request_id":id,"text":"中文👩‍💻".repeat(1000)}),
            None,
            false,
        )
        .unwrap();
        s.mark(&id, "FAILED", Some(&json!({"state":"FAILED"})))
            .unwrap();
        ids.push(id);
    }
    s.mark(&ids[0], "RECEIPT_MISSING", None).unwrap();
    s.db.execute("UPDATE outbox SET created=0", []).unwrap();
    s.cleanup().unwrap();
    assert_eq!(
        s.snapshot("d").unwrap()["outbox"].as_array().unwrap().len(),
        50
    );
    let first = s.message_outbox("d", None).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 50);
    let second = s.message_outbox("d", first["next"].as_i64()).unwrap();
    assert_eq!(second["items"].as_array().unwrap().len(), 10);
    assert_eq!(
        s.message_body("d", &ids[0]).unwrap()["text"],
        "中文👩‍💻".repeat(1000)
    );
    assert!(s.message_body("other", &ids[0]).is_err());
    assert!(s.discard_message("d", &ids[0]).is_err());
    s.discard_message("d", &ids[1]).unwrap();
    assert!(s.message_body("d", &ids[1]).is_err());
    s.bind("d", "new-instance").unwrap();
    assert!(s.discard_message("d", &ids[2]).is_err());
    assert_eq!(
        s.db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn protected_quota_refuses_new_intent_without_losing_saved_draft() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Storage::open(&dir.path().join("client")).unwrap();
    s.bind("d", "i").unwrap();
    for _ in 0..1000 {
        let id = uuid::Uuid::new_v4().to_string();
        s.enqueue(
            "d",
            "i",
            &Query::new("messages"),
            &json!({"request_id":id,"text":"failed"}),
            None,
            false,
        )
        .unwrap();
        s.mark(&id, "FAILED", Some(&json!({"state":"FAILED"})))
            .unwrap();
    }
    s.save_draft("d", "message", 0, "only copy").unwrap();
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"only copy"});
    assert_eq!(
        s.enqueue(
            "d",
            "i",
            &Query::new("messages"),
            &body,
            Some(("message", 1)),
            false
        )
        .unwrap_err(),
        "OUTBOX_QUOTA"
    );
    assert_eq!(s.draft("d", "message").unwrap()["text"], "only copy");
}
#[test]
fn native_url_validation_rejects_navigation_escape() {
    for url in [
        "javascript:alert(1)",
        "file:///tmp/x",
        "https://u:p@example.com",
        "https://example.com/%0afoo",
        "https://exa\nmple.com",
        "https://example.com/ x",
        "data:text/html,x",
    ] {
        assert!(external_url(url).is_err(), "{url}");
    }
    assert!(external_url("https://例子.测试/path")
        .unwrap()
        .as_str()
        .contains("xn--"));
}
