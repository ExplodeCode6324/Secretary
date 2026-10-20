import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from phaseui_measurement_contract import validate
class PhaseMeasurement(unittest.TestCase):
    def test_missing_or_truncated_is_not_zero_cost(self):
        self.assertTrue(validate(None,'idle','off',62,False))
        good=dict(active_ticks=1200,expected_ticks=1200,schedule_lateness_max_ms=20,background_ticks=0,phaseui=True,scenario='stream-stress',mode='base',seed=62,completed=True,queue=0,samples=3600,active_ms=61000,recovery_ms=30001,updates=1200,recovery=dict(effects=0,nodes=0,timers=0,listeners=10),baseline=dict(listeners=10))
        self.assertEqual(validate(good,'stream-stress','base',62,True),[])
        for patch in [dict(schedule_lateness_max_ms=300),dict(active_ticks=1199),dict(background_ticks=1),dict(updates=1199),dict(recovery_ms=29999),dict(samples=0),dict(mode='off'),dict(completed=False),dict(recovery=dict(effects=1,nodes=0,timers=1,listeners=10))]:
            self.assertTrue(validate({**good,**patch},'stream-stress','base',62,True))

    def test_systematic_missing_frame_is_invalid(self):
        good=dict(active_ticks=1200,expected_ticks=1200,schedule_lateness_max_ms=20,background_ticks=0,phaseui=True,scenario='single',mode='base',seed=62,completed=True,queue=0,samples=3600,active_ms=60000,recovery_ms=30001,updates=120,coverage=True,motion=dict(completed=120,covered=120),recovery=dict(effects=0,nodes=0,timers=0,listeners=10),baseline=dict(listeners=10))
        self.assertEqual(validate(good,'single','base',62,True),[])
        self.assertTrue(validate({**good,'motion':dict(completed=120,covered=1)},'single','base',62,True))
        self.assertEqual(validate({**good,'coverage':False,'motion':dict(completed=120,covered=0)},'single','base',62,True),[])
