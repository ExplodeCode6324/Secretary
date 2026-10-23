pub mod bridge;
pub mod discovery;
pub mod presentation;
pub mod protocol;
pub mod storage;
pub mod sync;
pub mod transport;

// Only stable, locally constructed codes cross the IPC boundary. Never serialize
// reqwest/IO errors: those can contain the authenticated URL or response content.
pub type Result<T> = std::result::Result<T, String>;
pub fn err(code: &str) -> String {
    code.to_owned()
}
