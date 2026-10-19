import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from measurement_contract import validate_stream

class CompletionContractTest(unittest.TestCase):
    def test_complete_recovery(self):
        self.assertEqual(validate_stream(61, 91), 30)
    def test_late_completion_with_short_recovery_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "incomplete recovery"):
            validate_stream(170, 180)
    def test_no_completion_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "did not finish"):
            validate_stream(None, 180)
    def test_completion_deadline_is_enforced(self):
        with self.assertRaisesRegex(ValueError, "deadline"):
            validate_stream(181, 212)
