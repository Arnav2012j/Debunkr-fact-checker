import { Router, type IRouter } from "express";
import healthRouter from "./health";
import checkRouter from "./check";

const router: IRouter = Router();

router.use(healthRouter);
router.use(checkRouter);

export default router;
