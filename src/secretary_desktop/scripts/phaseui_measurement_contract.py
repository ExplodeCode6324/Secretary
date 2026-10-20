def validate(report, scenario, mode, seed, ready):
    if not isinstance(report,dict):return ['missing report']
    errors=[]
    for key,value in [('phaseui',True),('scenario',scenario),('mode',mode),('seed',seed),('completed',True),('queue',0)]:
        if report.get(key)!=value:errors.append('invalid '+key)
    if not ready:errors.append('missing readiness')
    if report.get('background_ticks')!=0:errors.append('window was hidden or unfocused during active schedule')
    if report.get('samples',0)<1000:errors.append('insufficient rAF samples')
    if report.get('active_ms',0)<59000:errors.append('incomplete active schedule')
    if report.get('recovery_ms',0)<30000:errors.append('incomplete recovery')
    if scenario!='idle' and report.get('active_ticks')!=report.get('expected_ticks'):errors.append('incomplete fixed replay schedule')
    if scenario!='idle' and report.get('schedule_lateness_max_ms',float('inf'))>250:errors.append('replay deadline exceeded 250ms')
    if scenario=='stream-stress' and report.get('updates')!=1200:errors.append('stream did not drain 1200 updates')
    if scenario not in ['idle','stream-stress'] and report.get('updates',0)<100:errors.append('insufficient actions')
    recovery=report.get('recovery',{});baseline=report.get('baseline',{})
    for key in ['effects','nodes','timers']:
        if recovery.get(key)!=0:errors.append('unreleased '+key)
    if recovery.get('listeners')!=baseline.get('listeners'):errors.append('listener recovery differs')
    if report.get('coverage') and scenario in ['single','navigation'] and mode!='off':
        motion=report.get('motion',{})
        if motion.get('completed',0)<10:errors.append('insufficient completed effects')
        completed=motion.get('completed',0)
        if completed and motion.get('covered',0)/completed<0.95:errors.append('systematic missing frame: complete coverage below 95%')
    return errors
