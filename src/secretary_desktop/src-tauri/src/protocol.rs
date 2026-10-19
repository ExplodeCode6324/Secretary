use crate::{err, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub operation: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub parameters: BTreeMap<String, Value>,
}
impl Query {
    pub fn new(operation: &str) -> Self {
        Self {
            operation: operation.into(),
            id: None,
            parameters: BTreeMap::new(),
        }
    }
    pub fn key(&self) -> String {
        serde_json::to_string(self).expect("query")
    }
}
fn operations() -> &'static Vec<Value> {
    static OPS: OnceLock<Vec<Value>> = OnceLock::new();
    OPS.get_or_init(|| {
        serde_json::from_str(include_str!("../contracts/operations.json"))
            .expect("generated operations")
    })
}
pub fn operation(method: &str, name: &str) -> Result<&'static Value> {
    operations()
        .iter()
        .find(|o| o["method"] == method && o["path"].as_str() == Some(&format!("/api/v1/{name}")))
        .ok_or_else(|| err("UNSUPPORTED_OPERATION"))
}
pub fn route(method: &str, query: &Query) -> Result<String> {
    let op = operation(method, &query.operation)?;
    let mut path = query.operation.clone();
    if path.contains("{id}") {
        let id = query.id.as_deref().ok_or_else(|| err("INVALID_ID"))?;
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(err("INVALID_ID"));
        }
        path = path.replace("{id}", id);
    } else if query.id.is_some() {
        return Err(err("INVALID_ID"));
    }
    let specs = op["parameters"].as_array().cloned().unwrap_or_default();
    for spec in &specs {
        if spec["required"] == true
            && !query
                .parameters
                .contains_key(spec["name"].as_str().unwrap_or(""))
        {
            return Err(err("INVALID_QUERY"));
        }
    }
    let mut url = reqwest::Url::parse("http://127.0.0.1/").expect("constant");
    for (name, value) in &query.parameters {
        let spec = specs
            .iter()
            .find(|s| s["name"] == *name && s["in"] == "query")
            .ok_or_else(|| err("INVALID_QUERY"))?;
        if !jsonschema::is_valid(&spec["schema"], value) {
            return Err(err("INVALID_QUERY"));
        }
        let text = value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string());
        if text.len() > 2048 {
            return Err(err("INVALID_QUERY"));
        }
        url.query_pairs_mut().append_pair(name, &text);
    }
    if let Some(q) = url.query() {
        path.push('?');
        path.push_str(q);
    }
    Ok(path)
}
fn relax(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if map
                .get("enum")
                .and_then(Value::as_array)
                .is_some_and(|values| values.iter().all(Value::is_string))
                && !map.contains_key("type")
            {
                map.insert("type".into(), json!("string"));
            }
            map.remove("enum");
            map.remove("additionalProperties");
            for v in map.values_mut() {
                relax(v);
            }
        }
        Value::Array(values) => {
            for v in values {
                relax(v);
            }
        }
        _ => (),
    }
}
pub fn validate(name: &str, data: &Value, response: bool) -> Result<()> {
    static VALIDATORS: OnceLock<
        std::sync::Mutex<BTreeMap<String, std::sync::Arc<jsonschema::Validator>>>,
    > = OnceLock::new();
    let key = format!("{name}:{response}");
    let mut validators = VALIDATORS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| err("CONTRACT_INVALID"))?;
    if !validators.contains_key(&key) {
        let source: Value = serde_json::from_str(include_str!("../contracts/schema.json"))
            .expect("generated schema");
        let mut schema = json!({"$schema":"https://json-schema.org/draft/2020-12/schema", "$defs":source["$defs"], "$ref":format!("#/$defs/{name}")});
        if response {
            relax(&mut schema);
        }
        let validator = jsonschema::options()
            .should_validate_formats(true)
            .build(&schema)
            .map_err(|_| err("CONTRACT_INVALID"))?;
        validators.insert(key.clone(), std::sync::Arc::new(validator));
    }
    let validator = validators[&key].clone();
    drop(validators);
    if validator.is_valid(data) {
        Ok(())
    } else {
        Err(err(if response {
            "INVALID_RESPONSE"
        } else {
            "INVALID_COMMAND"
        }))
    }
}

pub fn command(query: &Query, body: &Value) -> Result<String> {
    let route = route("POST", query)?;
    let op = operation("POST", &query.operation)?;
    if body.to_string().len() > 1024 * 1024 {
        return Err(err("COMMAND_TOO_LARGE"));
    }
    validate(
        op["request"]
            .as_str()
            .ok_or_else(|| err("INVALID_COMMAND"))?,
        body,
        false,
    )?;
    Ok(route)
}
pub fn error_code(code: &str) -> String {
    // Codes are protocol identifiers; never return arbitrary server strings.
    if !code.is_empty()
        && code.len() <= 64
        && code.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
    {
        code.into()
    } else {
        err("CORE_REQUEST_FAILED")
    }
}
