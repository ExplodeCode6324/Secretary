use serde::Serialize;
#[derive(Debug, Serialize, PartialEq)]
pub struct Launch {
    pub study: bool,
    pub scenario: String,
    pub phase: String,
    pub motion: String,
    pub seed: u32,
    pub measure: bool,
    pub coverage: bool,
    pub theme: String,
    pub width: u32,
}
pub fn parse(get: impl Fn(&str) -> Option<String>) -> Result<Launch, String> {
    let value = |key| get(key).unwrap_or_default();
    let phase = value("SECRETARY_PHASEUI_SCENARIO");
    let scenario = value("SECRETARY_STUDY_SCENARIO");
    let study_flag = value("SECRETARY_STUDY") == "1";
    if !phase.is_empty() && (study_flag || !scenario.is_empty()) {
        return Err("Conflicting PhaseUI and legacy study selectors".into());
    }
    if ![
        "",
        "gallery",
        "idle",
        "single",
        "navigation",
        "input-scroll",
        "stream-stress",
        "bridge-cadence",
        "conversation-stream",
        "conversation-history",
        "conversation-expand",
        "conversation-static",
    ]
    .contains(&phase.as_str())
    {
        return Err("Unknown PhaseUI scenario".into());
    }
    if !["", "load", "stream", "load-baseline", "stream-baseline"].contains(&scenario.as_str()) {
        return Err("Unknown legacy study scenario".into());
    }
    let motion = get("SECRETARY_PHASEUI_MOTION").unwrap_or_else(|| "base".into());
    if !["off", "base", "extended"].contains(&motion.as_str()) {
        return Err("Unknown PhaseUI motion mode".into());
    }
    let seed = get("SECRETARY_PHASEUI_SEED")
        .unwrap_or_else(|| "62".into())
        .parse::<u32>()
        .map_err(|_| "PhaseUI seed must be an unsigned 32-bit integer")?;
    let coverage = get("SECRETARY_PHASEUI_COVERAGE").unwrap_or_else(|| "1".into());
    if !["0", "1"].contains(&coverage.as_str()) {
        return Err("Invalid coverage selector".into());
    }
    let theme = get("SECRETARY_PHASEUI_THEME").unwrap_or_else(|| "light".into());
    if !["light", "dark"].contains(&theme.as_str()) {
        return Err("Invalid theme".into());
    }
    let width = get("SECRETARY_PHASEUI_WIDTH")
        .unwrap_or_else(|| "1180".into())
        .parse::<u32>()
        .map_err(|_| "Invalid width")?;
    if !(480..=1800).contains(&width) {
        return Err("Invalid width".into());
    }
    Ok(Launch {
        study: study_flag || !scenario.is_empty(),
        scenario,
        phase,
        motion,
        seed,
        measure: value("SECRETARY_STUDY_MEASURE") == "1",
        coverage: coverage == "1",
        theme,
        width,
    })
}
pub fn current() -> Result<Launch, String> {
    parse(|key| std::env::var(key).ok())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn config(pairs: &[(&str, &str)]) -> Result<Launch, String> {
        parse(|key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        })
    }
    #[test]
    fn ordinary_is_real_and_diagnostics_are_explicit() {
        let normal = config(&[]).unwrap();
        assert!(!normal.study);
        assert!(normal.phase.is_empty());
        assert_eq!(
            config(&[("SECRETARY_PHASEUI_SCENARIO", "gallery")])
                .unwrap()
                .phase,
            "gallery"
        );
        for input in [
            vec![("SECRETARY_PHASEUI_SCENARIO", "oops")],
            vec![
                ("SECRETARY_PHASEUI_SCENARIO", "idle"),
                ("SECRETARY_STUDY", "1"),
            ],
            vec![("SECRETARY_PHASEUI_SEED", "-1")],
            vec![("SECRETARY_PHASEUI_SEED", "4294967296")],
            vec![("SECRETARY_PHASEUI_MOTION", "fast")],
            vec![("SECRETARY_PHASEUI_COVERAGE", "maybe")],
            vec![("SECRETARY_PHASEUI_THEME", "unknown")],
            vec![("SECRETARY_PHASEUI_WIDTH", "479")],
        ] {
            assert!(config(&input).is_err());
        }
    }
}
