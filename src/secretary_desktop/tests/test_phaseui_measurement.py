import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from phaseui_measurement_contract import validate
class PhaseMeasurement(unittest.TestCase):
    def test_missing_or_truncated_is_not_zero_cost(self):
        self.assertTrue(validate(None,'idle','off',62,False))
        good=dict(phaseui=True,scenario='stream-stress',mode='base',seed=62,completed=True,queue=0,samples=3600,active_ms=61000,recovery_ms=30001,updates=1200,recovery=dict(effects=0,nodes=0,timers=0,listeners=10),baseline=dict(listeners=10))
        self.assertEqual(validate(good,'stream-stress','base',62,True),[])
        for patch in [dict(updates=1199),dict(recovery_ms=29999),dict(samples=0),dict(mode='off'),dict(completed=False),dict(recovery=dict(effects=1,nodes=0,timers=1,listeners=10))]:
            self.assertTrue(validate({**good,**patch},'stream-stress','base',62,True))
