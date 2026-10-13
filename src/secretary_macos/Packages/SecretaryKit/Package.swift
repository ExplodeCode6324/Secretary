// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SecretaryKit",
    platforms: [.macOS(.v14)],
    products: [.library(name: "SecretaryKit", targets: ["SecretaryKit"])],
    dependencies: [.package(url: "https://github.com/swiftlang/swift-markdown.git", exact: "0.6.0")],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "SecretaryKit", dependencies: ["CSQLite", .product(name: "Markdown", package: "swift-markdown")]),
        .executableTarget(name: "SecretaryProbe", dependencies: ["SecretaryKit"]),
        .testTarget(name: "SecretaryKitTests", dependencies: ["SecretaryKit"], resources: [.copy("Fixtures")])
    ],
    swiftLanguageModes: [.v6]
)
