using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using KRPC.Service;
using KRPC.Service.Attributes;
using UnityEngine;

namespace KRPC.StageStatsService
{
    /// <summary>
    /// Small reflection helpers. As with KRPC.SystemHeat, we deliberately do NOT
    /// reference MechJeb2.dll at compile time: MechJeb is version-pinned here
    /// (2.14.3.0 / KRPC.MechJeb 0.7.1) and reaching its types by reflection keeps
    /// this DLL from hard-binding a third assembly to that pin, and sidesteps the
    /// same Mono method-overload trap that bit the SystemHeat build.
    /// </summary>
    internal static class Reflect
    {
        internal const BindingFlags ALL =
            BindingFlags.Public | BindingFlags.NonPublic |
            BindingFlags.Instance | BindingFlags.Static;

        internal static object Field(object obj, string name)
        {
            FieldInfo f = obj.GetType().GetField(name, ALL);
            if (f == null)
                throw new MissingMemberException(obj.GetType().Name + "." + name);
            return f.GetValue(obj);
        }

        internal static float FloatField(object obj, string name)
        {
            return Convert.ToSingle(Field(obj, name));
        }
    }

    /// <summary>
    /// Exposes MechJeb's per-stage delta-V simulation over kRPC.
    ///
    /// Every fact this service relies on was confirmed against a live reflection
    /// dump on this specific install (KSP 1.12.5, MechJeb 2.14.3.0), not assumed:
    ///
    ///   * The module is MuMech.MechJebModuleStageStats, fetched by name via
    ///     MechJebCore.GetComputerModule("MechJebModuleStageStats").
    ///
    ///   * Its simulation is ASYNCHRONOUS. RequestUpdate(controller, wait) kicks
    ///     off a background sim; the result arrays populate a few frames later.
    ///     With RequestUpdate NOT being called, the numbers FREEZE while the
    ///     vessel keeps burning (confirmed: 17 s of identical DeltaV after the
    ///     calls stopped). So this service calls RequestUpdate on EVERY read.
    ///     Passing wait=false keeps us off the game thread's critical path; we
    ///     serve the most recent completed result, which at a 1 Hz poll is never
    ///     more than a frame or two stale.
    ///
    ///   * Per-stage stats live in FuelStats[] atmoStats and FuelStats[] vacStats.
    ///     FuelStats exposes StartMass, EndMass, StartThrust, EndThrust, MaxThrust,
    ///     MaxAccel, DeltaTime, DeltaV, Isp, StagedMass, SpoolUpTime, ResourceMass.
    ///     There is NO TWR field; TWR is derived (see StageTWR).
    ///
    ///   * ARRAY ORDER (the trap): index 0 is the FINAL/upper stage; the LAST
    ///     index is the currently-burning stage. This is the reverse of the KSP
    ///     stage numbering, where vessel.currentStage counts DOWN to 0. Confirmed
    ///     by watching currentStage decrement 3->0 while index 0 stayed the
    ///     payload stage throughout. The per-stage procedures here are indexed by
    ///     ARRAY INDEX; use CurrentStageIndex / KspStageToIndex to map.
    ///
    ///   * atmoStats is the current-atmosphere figure (the like-for-like match for
    ///     Telemachus's dv.stageDVActual); vacStats is vacuum. Kerbal Engineer and
    ///     MechJeb share delta-V simulation code, so these match the KER readout
    ///     used in the VAB.
    ///
    /// Fluxes/masses are MechJeb's own units: mass in tonnes, thrust in kN,
    /// delta-V in m/s, Isp in s, time in s.
    /// </summary>
    [KRPCService(Name = "StageStats", GameScene = Service.GameScene.Flight)]
    public static class StageStatsKrpcService
    {
        // ------------------------------------------------------------------
        // Locating MechJeb + its stage-stats module
        // ------------------------------------------------------------------
        static PartModule FindCore()
        {
            Vessel vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
                return null;
            foreach (Part p in vessel.parts)
                foreach (PartModule pm in p.Modules)
                    if (pm.moduleName == "MechJebCore")
                        return pm;
            return null;
        }

        // MechJebCore.GetComputerModule(string) -> ComputerModule, confirmed present.
        static object GetStatsModule(PartModule core)
        {
            MethodInfo byName = null;
            foreach (MethodInfo m in core.GetType().GetMethods(Reflect.ALL))
            {
                if (m.Name != "GetComputerModule" || m.IsGenericMethod)
                    continue;
                ParameterInfo[] ps = m.GetParameters();
                if (ps.Length == 1 && ps[0].ParameterType == typeof(string))
                {
                    byName = m;
                    break;
                }
            }
            if (byName == null)
                return null;
            try
            {
                object mod = byName.Invoke(core, new object[] { "MechJebModuleStageStats" });
                if (mod != null &&
                    mod.GetType().Name.IndexOf("StageStats", StringComparison.OrdinalIgnoreCase) >= 0)
                    return mod;
            }
            catch { }
            return null;
        }

        // Cache the stats module, but re-resolve if the active vessel changed
        // (staging, docking, vessel switch all invalidate the old MechJebCore).
        static object _statsCache;
        static Guid _statsVesselId;

        static object Stats()
        {
            Vessel v = FlightGlobals.ActiveVessel;
            if (v == null)
                return null;
            if (_statsCache != null && v.id == _statsVesselId)
                return _statsCache;

            PartModule core = FindCore();
            object stats = core != null ? GetStatsModule(core) : null;
            _statsCache = stats;
            _statsVesselId = v.id;
            return stats;
        }

        static object RequireStats()
        {
            object s = Stats();
            if (s == null)
                throw new InvalidOperationException(
                    "MechJeb stage-stats module not available (MechJeb not installed, " +
                    "not present on this vessel, or no active vessel)");
            return s;
        }

        // ------------------------------------------------------------------
        // Driving the async simulation. MUST run before every read or the
        // arrays go stale (confirmed by the RequestUpdate=OFF freeze test).
        // ------------------------------------------------------------------
        static MethodInfo _requestUpdate;
        static bool _requestUpdateResolved;
        // Stable token registered with MechJeb as the "controller"/user. The
        // dumper -- the only configuration PROVEN to yield live data -- passed a
        // real object instance (itself). MechJeb tracks users by object in a
        // pool, so we match that shape rather than passing a Type object.
        static readonly object _mjUserToken = new object();

        static void Pump(object stats)
        {
            if (!_requestUpdateResolved)
            {
                _requestUpdateResolved = true;
                foreach (MethodInfo m in stats.GetType().GetMethods(Reflect.ALL))
                {
                    if (m.Name != "RequestUpdate")
                        continue;
                    // Confirmed signature: RequestUpdate(object controller, bool wait).
                    ParameterInfo[] ps = m.GetParameters();
                    if (ps.Length == 2 && ps[1].ParameterType == typeof(bool))
                    {
                        _requestUpdate = m;
                        break;
                    }
                    if (_requestUpdate == null)
                        _requestUpdate = m;   // fall back to whatever RequestUpdate exists
                }
            }
            if (_requestUpdate == null)
                return;
            try
            {
                ParameterInfo[] ps = _requestUpdate.GetParameters();
                object[] args = new object[ps.Length];
                for (int i = 0; i < ps.Length; i++)
                {
                    // controller arg: MechJeb registers this object in its user
                    // pool; pass our stable instance token (matches the proven
                    // dumper call). wait arg: false, so we never block the game
                    // thread -- the KeepWarm addon keeps the sim continuously
                    // fresh, so non-blocking reads see recent results.
                    if (ps[i].ParameterType == typeof(bool))
                        args[i] = false;
                    else
                        args[i] = _mjUserToken;
                }
                _requestUpdate.Invoke(stats, args);
            }
            catch { /* a failed pump just means this read may be a frame stale */ }
        }

        static IList AtmoArray(object stats)
        {
            return Reflect.Field(stats, "atmoStats") as IList;
        }

        static IList VacArray(object stats)
        {
            return Reflect.Field(stats, "vacStats") as IList;
        }

        static object RequireEntry(bool vacuum, int index)
        {
            object stats = RequireStats();
            Pump(stats);
            IList arr = vacuum ? VacArray(stats) : AtmoArray(stats);
            if (arr == null)
                throw new InvalidOperationException("Stage stats not computed yet");
            if (index < 0 || index >= arr.Count)
                throw new ArgumentOutOfRangeException(
                    "index", "Stage index " + index + " out of range (count " + arr.Count + ")");
            return arr[index];
        }

        // ------------------------------------------------------------------
        // Public API
        // ------------------------------------------------------------------

        /// <summary>Whether MechJeb's stage-stats module is available on the active vessel.</summary>
        [KRPCProperty]
        public static bool Available
        {
            get { return Stats() != null; }
        }

        /// <summary>
        /// Number of stages in the delta-V table. Index 0 is the final/upper
        /// stage; the last index is the stage burning now. This includes
        /// zero-thrust "stages" (pure decouplers/fairings) that MechJeb still
        /// lists; their DeltaV is 0.
        /// </summary>
        [KRPCProcedure]
        public static int StageCount()
        {
            object stats = RequireStats();
            Pump(stats);
            IList arr = AtmoArray(stats);
            return arr == null ? 0 : arr.Count;
        }

        /// <summary>
        /// The KSP stage index (as vessel.currentStage reports, counting DOWN to
        /// 0) of the currently-active stage. Provided because kRPC core does not
        /// expose current stage on this build; the dashboard also uses it to
        /// un-blank its current-stage resource column.
        /// </summary>
        [KRPCProcedure]
        public static int CurrentStage()
        {
            Vessel v = FlightGlobals.ActiveVessel;
            if (v == null)
                throw new InvalidOperationException("No active vessel");
            return v.currentStage;
        }

        /// <summary>
        /// Convert a KSP stage number (v.currentStage style, counting down to 0)
        /// to the corresponding index in the atmo/vac arrays. The active stage's
        /// stats are always at the LAST populated index, so this returns
        /// (StageCount - 1) for the current stage and walks backward from there.
        /// Returns -1 if the KSP stage isn't represented in the table.
        /// </summary>
        [KRPCProcedure]
        public static int KspStageToIndex(int kspStage)
        {
            Vessel v = FlightGlobals.ActiveVessel;
            if (v == null)
                return -1;
            int count = StageCount();
            if (count <= 0)
                return -1;
            // The current KSP stage maps to the last array index; each older
            // (higher-numbered) KSP stage maps one index lower.
            int idx = (count - 1) - (v.currentStage - kspStage);
            return (idx >= 0 && idx < count) ? idx : -1;
        }

        /// <summary>Array index of the currently-burning stage (always StageCount - 1, or -1 if empty).</summary>
        [KRPCProcedure]
        public static int CurrentStageIndex()
        {
            int count = StageCount();
            return count > 0 ? count - 1 : -1;
        }

        // ---- per-stage scalars (indexed by ARRAY INDEX; vacuum flag picks table) ----

        /// <summary>Delta-V of the stage at the given array index, in m/s. vacuum=false gives the current-atmosphere figure.</summary>
        [KRPCProcedure]
        public static float StageDeltaV(int index, bool vacuum)
        {
            return Reflect.FloatField(RequireEntry(vacuum, index), "DeltaV");
        }

        /// <summary>Burn time of the stage at the given array index, in seconds.</summary>
        [KRPCProcedure]
        public static float StageBurnTime(int index, bool vacuum)
        {
            return Reflect.FloatField(RequireEntry(vacuum, index), "DeltaTime");
        }

        /// <summary>Start (wet) mass of the stage at the given array index, in tonnes.</summary>
        [KRPCProcedure]
        public static float StageStartMass(int index, bool vacuum)
        {
            return Reflect.FloatField(RequireEntry(vacuum, index), "StartMass");
        }

        /// <summary>End (dry) mass of the stage at the given array index, in tonnes.</summary>
        [KRPCProcedure]
        public static float StageEndMass(int index, bool vacuum)
        {
            return Reflect.FloatField(RequireEntry(vacuum, index), "EndMass");
        }

        /// <summary>Max thrust of the stage at the given array index, in kN.</summary>
        [KRPCProcedure]
        public static float StageMaxThrust(int index, bool vacuum)
        {
            return Reflect.FloatField(RequireEntry(vacuum, index), "MaxThrust");
        }

        /// <summary>Effective Isp of the stage at the given array index, in seconds.</summary>
        [KRPCProcedure]
        public static float StageIsp(int index, bool vacuum)
        {
            return Reflect.FloatField(RequireEntry(vacuum, index), "Isp");
        }

        /// <summary>
        /// Thrust-to-weight ratio of the stage at the given array index, at
        /// liftoff of that stage. DERIVED, because FuelStats has no TWR field:
        ///   TWR = MaxThrust / (StartMass * g)
        /// g is the surface gravity of the vessel's current main body, matching
        /// how MechJeb and Kerbal Engineer present TWR in the VAB. Returns 0 for
        /// zero-thrust stages (pure decouplers) rather than dividing by a live g
        /// into a meaningless number.
        /// </summary>
        [KRPCProcedure]
        public static float StageTWR(int index, bool vacuum)
        {
            object e = RequireEntry(vacuum, index);
            float thrust = Reflect.FloatField(e, "MaxThrust");   // kN
            float startMass = Reflect.FloatField(e, "StartMass"); // t
            if (thrust <= 0f || startMass <= 0f)
                return 0f;

            Vessel v = FlightGlobals.ActiveVessel;
            double g = (v != null && v.mainBody != null)
                ? v.mainBody.GeeASL * 9.81   // GeeASL is in g's; convert to m/s^2
                : 9.81;
            // thrust(kN)=thrust*1000 N; weight = startMass(t)*1000 kg * g. The
            // 1000s cancel: TWR = thrust / (startMass * g).
            return (float)(thrust / (startMass * g));
        }

        /// <summary>
        /// Called every frame by StageStatsKeepWarm (below) to keep MechJeb's
        /// stage-stats simulation continuously running. MechJeb only simulates
        /// while something is registered as a "user" via RequestUpdate and only
        /// produces results a frame or two later (it's async). Poking it just
        /// 2x/second from the RPC read path (as Pump does) left MechJeb idle
        /// between pokes, so it never ran the full sim and every stage read back
        /// the same degenerate ~17.8 m/s. Registering every frame -- exactly what
        /// MechJeb's own delta-V window does -- keeps the real multi-stage result
        /// warm so the RPC reads get fresh, correct numbers.
        /// </summary>
        internal static void KeepWarm()
        {
            object stats = Stats();
            if (stats != null)
                Pump(stats);
        }
    }

    /// <summary>
    /// Keeps MechJeb's stage-stats sim running every frame so the kRPC reads
    /// return real, fully-populated per-stage numbers rather than a stale single
    /// value. This is the same "call RequestUpdate every frame" pattern the
    /// diagnostic dumper used -- which is why the dumper produced correct dV
    /// while the on-demand service did not.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, false)]
    public class StageStatsKeepWarm : MonoBehaviour
    {
        void Update()
        {
            try { StageStatsKrpcService.KeepWarm(); }
            catch { /* never let a keep-warm hiccup spam the log */ }
        }
    }
}
